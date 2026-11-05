import { expect, it } from 'vitest';
import { encodeAbiParameters, encodeFunctionData, keccak256, stringToHex, zeroAddress } from 'viem';
import { officialTables } from '../src/replay';
const contract = '0x000000000000000000000000000000000000beef';
const wallet = '0x00000000000000000000000000000000000000a1';
const txHash = '0x' + '12'.repeat(32);
const blockHash = '0x' + '34'.repeat(32);
const tableId = officialTables()[0].tableId;
const abi = [{ type: 'function', name: 'startRun', inputs: [{ type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' }] as const;
function fixture() {
  const tx: any = { hash: txHash, from: wallet, to: contract, value: '0x0', input: encodeFunctionData({ abi, functionName: 'startRun', args: [tableId] }), blockHash, blockNumber: '0x10', chainId: '0xaa36a7' };
  const log: any = { address: contract, topics: [keccak256(stringToHex('RunStarted(address,bytes32)')), encodeAbiParameters([{ type: 'address' }], [wallet]), tableId], data: '0x', transactionHash: txHash, blockHash, blockNumber: '0x10', removed: false };
  const receipt: any = { transactionHash: txHash, from: wallet, to: contract, status: '0x1', blockHash, blockNumber: '0x10', logs: [log] };
  const responses: Record<string, any> = { eth_chainId: '0xaa36a7', eth_getTransactionByHash: tx, eth_getTransactionReceipt: receipt, eth_blockNumber: '0x12', eth_getBlockByNumber: { hash: blockHash, number: '0x10', timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16) } };
  return { responses, tx, log, receipt };
}
it('verifies simulated Sepolia RPC evidence: successful canonical receipt, exact caller/calldata/event and confirmations', async () => {
  const mod = await import('../src/vps/v2/chain').catch(() => null);
  expect(mod, 'ranked chain verifier is missing').not.toBeNull();
  const f = fixture();
  const chain = mod!.createStartChain(async (method: string) => f.responses[method], { contract, confirmations: 3 });
  expect(await chain.verify(wallet, tableId, txHash, true)).toEqual({ blockHash, blockNumber: '0x10' });
});
it.each(['chain', 'missing', 'failed', 'wallet', 'to', 'table', 'value', 'input', 'event', 'logContract', 'logWallet', 'logTable', 'removed', 'logHash', 'duplicate', 'unconfirmed', 'reorg', 'old', 'future'])('rejects invalid chain/start evidence: %s', async mode => {
  const mod = await import('../src/vps/v2/chain').catch(() => null);
  expect(mod, 'ranked chain verifier is missing').not.toBeNull();
  const f = fixture();
  if (mode === 'chain') f.responses.eth_chainId = '0x1';
  if (mode === 'missing') f.responses.eth_getTransactionReceipt = null;
  if (mode === 'failed') f.receipt.status = '0x0';
  if (mode === 'wallet') f.tx.from = zeroAddress;
  if (mode === 'to') f.tx.to = zeroAddress;
  if (mode === 'table') f.tx.input = encodeFunctionData({ abi, functionName: 'startRun', args: [officialTables()[1].tableId] });
  if (mode === 'value') f.tx.value = '0x1';
  if (mode === 'input') f.tx.input += '00';
  if (mode === 'event') f.log.topics[0] = '0x' + 'ff'.repeat(32);
  if (mode === 'logContract') f.log.address = zeroAddress;
  if (mode === 'logWallet') f.log.topics[1] = encodeAbiParameters([{ type: 'address' }], [zeroAddress]);
  if (mode === 'logTable') f.log.topics[2] = officialTables()[1].tableId;
  if (mode === 'removed') f.log.removed = true;
  if (mode === 'logHash') f.log.transactionHash = '0x' + 'ff'.repeat(32);
  if (mode === 'duplicate') f.receipt.logs.push({ ...f.log });
  if (mode === 'unconfirmed') f.responses.eth_blockNumber = '0x11';
  if (mode === 'reorg') f.responses.eth_getBlockByNumber.hash = '0x' + 'ff'.repeat(32);
  if (mode === 'old') f.responses.eth_getBlockByNumber.timestamp = '0x1';
  if (mode === 'future') f.responses.eth_getBlockByNumber.timestamp = '0xfffffffff';
  const chain = mod!.createStartChain(async (method: string) => f.responses[method], { contract, confirmations: 3 });
  await expect(chain.verify(wallet, tableId, txHash, true)).rejects.toThrow();
});
