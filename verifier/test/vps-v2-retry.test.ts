import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { encodeAbiParameters, encodeFunctionData, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { officialTables } from '../src/replay';
import { createStartChain, startAbi } from '../src/vps/v2/chain';
import { createRankedService, openRankedDatabase, startMessage } from '../src/vps/v2/service';

const account = privateKeyToAccount(('0x' + '11'.repeat(32)) as `0x${string}`);
const contract = '0x000000000000000000000000000000000000beef';
const txHash = '0x' + '12'.repeat(32);
const blockHash = '0x' + '34'.repeat(32);
const minedAt = 2_000_000_000;
const closes: (() => void)[] = [];
const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const close of closes.splice(0)) close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
async function setup() {
  const clock = vi.spyOn(Date, 'now').mockReturnValue((minedAt + 600) * 1000);
  const tableId = officialTables()[0].tableId;
  const tx = { hash: txHash, from: account.address, to: contract, value: '0x0',
    input: encodeFunctionData({ abi: startAbi, functionName: 'startRun', args: [tableId] }), blockHash, blockNumber: '0x10', chainId: '0xaa36a7' };
  const log = { address: contract, topics: [keccak256(stringToHex('RunStarted(address,bytes32)')),
    encodeAbiParameters([{ type: 'address' }], [account.address]), tableId], data: '0x', transactionHash: txHash, blockHash, blockNumber: '0x10', removed: false };
  const receipt = { transactionHash: txHash, from: account.address, to: contract, status: '0x1', blockHash, blockNumber: '0x10', logs: [log] };
  const block = { hash: blockHash, number: '0x10', timestamp: '0x' + minedAt.toString(16) };
  const responses: Record<string, unknown> = { eth_chainId: '0xaa36a7', eth_getTransactionByHash: tx,
    eth_getTransactionReceipt: receipt, eth_blockNumber: '0x12', eth_getBlockByNumber: block };
  const rpc = vi.fn(async (method: string) => responses[method]);
  const chain = createStartChain(rpc, { contract, confirmations: 3 });
  const dir = mkdtempSync(join(process.platform === 'win32' ? join(process.env.LOCALAPPDATA!, 'hermes/cache/scratch') : tmpdir(), 'pinball-v2-retry-'));
  dirs.push(dir);
  const path = join(dir, 'ranked.sqlite');
  const db = openRankedDatabase(path); closes.push(() => db.close());
  const service = createRankedService(db, chain, { contract, confirmations: 3 });
  const body = { wallet: account.address, tableId, txHash,
    signature: await account.signMessage({ message: startMessage({ wallet: account.address, tableId, txHash, contract }) }) };
  const call = async (input: unknown = body, handler = service) => {
    const r = await handler(new Request('https://game.example/v2/runs', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
    return { status: r.status, body: await r.json() as any };
  };
  return { clock, tableId, tx, log, receipt, block, responses, rpc, chain, path, db, body, call };
}
it.each([[900, 201], [901, 410]])('enforces freshness for a first admission at transaction age %s seconds', async (age, status) => {
  const s = await setup();
  s.clock.mockReturnValue((minedAt + age) * 1000);
  expect((await s.call()).status).toBe(status);
  expect(Boolean(s.db.get(txHash))).toBe(status === 201);
});
it('authenticates before looking up an existing run or revalidating chain evidence', async () => {
  const s = await setup();
  expect((await s.call()).status).toBe(201);
  s.clock.mockReturnValue((minedAt + 901) * 1000);
  const get = vi.spyOn(s.db, 'get');
  s.rpc.mockClear();
  expect((await s.call({ ...s.body, signature: '0x' + '00'.repeat(65) })).status).toBe(403);
  expect(get).not.toHaveBeenCalled();
  expect(s.rpc).not.toHaveBeenCalled();
});
it.each(['wallet', 'table'] as const)('rejects an authenticated conflicting %s binding without disclosing a nonce', async mode => {
  const s = await setup();
  const admitted = await s.call();
  const signer = mode === 'wallet' ? privateKeyToAccount(('0x' + '22'.repeat(32)) as `0x${string}`) : account;
  const changed = { ...s.body, wallet: signer.address, tableId: mode === 'table' ? officialTables()[1].tableId : s.tableId };
  changed.signature = await signer.signMessage({ message: startMessage({ ...changed, contract }) });
  s.clock.mockReturnValue((minedAt + 901) * 1000);
  s.rpc.mockClear();
  const denied = await s.call(changed);
  expect(denied.status).toBe(409);
  expect(denied.body.nonce).toBeUndefined();
  expect(s.rpc).not.toHaveBeenCalled();
  expect(s.db.get(txHash)!.nonce).toBe(admitted.body.nonce);
});
it.each([
  ['chain', 503], ['missing', 409], ['failed', 409], ['wallet', 400], ['contract', 400], ['table', 400],
  ['value', 400], ['calldata', 400], ['event', 400], ['logContract', 400], ['logWallet', 400], ['logTable', 400],
  ['removed', 400], ['logHash', 400], ['duplicate', 400], ['unconfirmed', 409], ['reorg', 409], ['newCanonicalBlock', 409], ['future', 410],
] as const)('revalidates old admitted transaction evidence on retry: %s', async (mode, status) => {
  const s = await setup();
  const admitted = await s.call();
  expect(admitted.status).toBe(201);
  s.clock.mockReturnValue((minedAt + 901) * 1000);
  if (mode === 'chain') s.responses.eth_chainId = '0x1';
  if (mode === 'missing') s.responses.eth_getTransactionReceipt = null;
  if (mode === 'failed') s.receipt.status = '0x0';
  if (mode === 'wallet') s.tx.from = contract;
  if (mode === 'contract') s.tx.to = account.address;
  if (mode === 'table') s.tx.input = encodeFunctionData({ abi: startAbi, functionName: 'startRun', args: [officialTables()[1].tableId] });
  if (mode === 'value') s.tx.value = '0x1';
  if (mode === 'calldata') s.tx.input += '00';
  if (mode === 'event') s.log.topics[0] = ('0x' + 'ff'.repeat(32)) as `0x${string}`;
  if (mode === 'logContract') s.log.address = account.address;
  if (mode === 'logWallet') s.log.topics[1] = encodeAbiParameters([{ type: 'address' }], [contract]);
  if (mode === 'logTable') s.log.topics[2] = officialTables()[1].tableId;
  if (mode === 'removed') s.log.removed = true;
  if (mode === 'logHash') s.log.transactionHash = '0x' + 'ff'.repeat(32);
  if (mode === 'duplicate') s.receipt.logs.push({ ...s.log });
  if (mode === 'unconfirmed') s.responses.eth_blockNumber = '0x11';
  if (mode === 'reorg') s.block.hash = '0x' + 'ff'.repeat(32);
  if (mode === 'newCanonicalBlock') s.tx.blockHash = s.receipt.blockHash = s.log.blockHash = s.block.hash = '0x' + 'ff'.repeat(32);
  if (mode === 'future') s.block.timestamp = '0xfffffffff';
  const denied = await s.call();
  expect(denied.status).toBe(status);
  expect(denied.body.nonce).toBeUndefined();
  expect(s.db.get(txHash)!.result).toBeNull();
  expect(s.db.get(txHash)!.nonce).toBe(admitted.body.nonce);
  expect(s.db.get(txHash)!.expires_at).toBe(admitted.body.expiresAt);
});
it.each(['complete', 'expire'] as const)('checks atomic run state after a retry RPC overlaps %s', async mode => {
  const s = await setup();
  const admitted = await s.call();
  s.clock.mockReturnValue((minedAt + 901) * 1000);
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  s.rpc.mockImplementationOnce(async () => { entered(); await barrier; return s.responses.eth_chainId; });
  const pending = s.call();
  await waiting;
  try {
    if (mode === 'complete') s.db.finish(txHash, admitted.body.nonce, { score: 0, proofHash: 'test-consumed' }, minedAt + 901);
    else s.clock.mockReturnValue((minedAt + 1500) * 1000);
    release();
    const denied = await pending;
    expect(denied.status).toBe(mode === 'complete' ? 409 : 410);
    expect(denied.body.nonce).toBeUndefined();
    expect(s.db.get(txHash)!.nonce).toBe(admitted.body.nonce);
    expect(s.db.get(txHash)!.expires_at).toBe(admitted.body.expiresAt);
  } finally { release(); await pending; }
});
it('rejects a retry whose revalidated block number no longer matches the persisted admission', async () => {
  const s = await setup();
  const admitted = await s.call();
  expect(admitted.status).toBe(201);
  s.clock.mockReturnValue((minedAt + 901) * 1000);
  s.tx.blockNumber = s.receipt.blockNumber = s.log.blockNumber = s.block.number = '0x11';
  s.responses.eth_blockNumber = '0x13';
  expect((await s.call()).status).toBe(409);
  expect(s.db.get(txHash)!.block_number).toBe('0x10');
  expect(s.db.get(txHash)!.nonce).toBe(admitted.body.nonce);
});
it.each(['active', 'invalidEvent', 'complete', 'expire'] as const)('handles an overlapping admission crossing transaction freshness: %s', async mode => {
  const s = await setup();
  s.clock.mockReturnValue((minedAt + 900) * 1000);
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  s.rpc.mockImplementationOnce(async () => { entered(); await barrier; return s.responses.eth_chainId; });
  const pending = s.call();
  await waiting;
  try {
    const admitted = await s.call();
    expect(admitted.status).toBe(201);
    s.clock.mockReturnValue((minedAt + (mode === 'expire' ? 1800 : 901)) * 1000);
    if (mode === 'invalidEvent') s.log.removed = true;
    if (mode === 'complete') s.db.finish(txHash, admitted.body.nonce, { score: 0, proofHash: 'test-consumed' }, minedAt + 901);
    release();
    const retried = await pending;
    if (mode === 'active') expect(retried).toEqual(admitted);
    else {
      expect(retried.status).toBe(mode === 'invalidEvent' ? 400 : mode === 'complete' ? 409 : 410);
      expect(retried.body.nonce).toBeUndefined();
    }
    expect(s.db.get(txHash)!.nonce).toBe(admitted.body.nonce);
    expect(s.db.get(txHash)!.expires_at).toBe(admitted.body.expiresAt);
  } finally { release(); await pending; }
});
it('retries an authenticated active admission after transaction freshness expires without renewing its nonce or lifetime, including restart', async () => {
  const s = await setup();
  const admitted = await s.call();
  expect(admitted.status).toBe(201);
  expect(admitted.body.expiresAt).toBe(minedAt + 1500);
  s.clock.mockReturnValue((minedAt + 901) * 1000);
  expect(await s.call()).toEqual(admitted);
  closes.pop()!();
  const reopened = openRankedDatabase(s.path); closes.push(() => reopened.close());
  const restarted = createRankedService(reopened, s.chain, { contract, confirmations: 3 });
  expect(await s.call(s.body, restarted)).toEqual(admitted);
  s.clock.mockReturnValue((minedAt + 1500) * 1000);
  expect((await s.call(s.body, restarted)).status).toBe(410);
  expect(reopened.get(txHash)!.nonce).toBe(admitted.body.nonce);
  expect(reopened.get(txHash)!.expires_at).toBe(minedAt + 1500);
});
