import { encodeAbiParameters, encodeFunctionData, keccak256, stringToHex } from 'viem';
import { denied } from './database';
import { officialTables } from '../../replay';
import type { StartChain } from './service';
export const startAbi = [{ type: 'function', name: 'startRun', inputs: [{ name: 'tableId', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'event', name: 'RunStarted', inputs: [{ name: 'wallet', type: 'address', indexed: true }, { name: 'tableId', type: 'bytes32', indexed: true }] }] as const;
export type Rpc = (method: string, params: unknown[]) => Promise<any>;
const equal = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) denied(503, 'invalid RPC quantity');
  return BigInt(value);
}
export function createStartChain(rpc: Rpc, config: { contract: string; confirmations: number }): StartChain {
  return {
    async verify(wallet, tableId, txHash, fresh) {
      if (!officialTables().some(t => t.tableId === tableId)) denied(400, 'invalid official table');
      if (quantity(await rpc('eth_chainId', [])) !== 11155111n) denied(503, 'RPC is not Ethereum Sepolia');
      const [tx, receipt] = await Promise.all([rpc('eth_getTransactionByHash', [txHash]), rpc('eth_getTransactionReceipt', [txHash])]);
      if (!tx || !receipt) denied(409, 'start transaction not mined');
      const input = encodeFunctionData({ abi: startAbi, functionName: 'startRun', args: [tableId as `0x${string}`] });
      if (!equal(tx.hash, txHash) || !equal(tx.from, wallet) || !equal(tx.to, config.contract) || !equal(tx.input, input) ||
          quantity(tx.value) !== 0n || quantity(tx.chainId) !== 11155111n) denied(400, 'start transaction binding mismatch');
      if (receipt.status !== '0x1' || !equal(receipt.transactionHash, txHash) || !equal(receipt.from, wallet) || !equal(receipt.to, config.contract) ||
          typeof receipt.blockHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(receipt.blockHash) ||
          !equal(tx.blockHash, receipt.blockHash) || tx.blockNumber !== receipt.blockNumber) denied(409, 'invalid start receipt');
      const height = quantity(receipt.blockNumber);
      const [head, block] = await Promise.all([rpc('eth_blockNumber', []), rpc('eth_getBlockByNumber', [receipt.blockNumber, false])]);
      if (quantity(head) < height + BigInt(config.confirmations) - 1n) denied(409, 'start transaction needs confirmations');
      if (!block || !equal(block.hash, receipt.blockHash) || quantity(block.number) !== height) denied(409, 'start transaction reorganized');
      const timestamp = quantity(block.timestamp);
      const now = BigInt(Math.floor(Date.now() / 1000));
      if (timestamp > now + 60n || (fresh && timestamp < now - 900n)) denied(410, 'start transaction outside admission window');
      if (!Array.isArray(receipt.logs) || receipt.logs.length !== 1) denied(400, 'invalid start event count');
      const log = receipt.logs[0];
      const topics = [keccak256(stringToHex('RunStarted(address,bytes32)')), encodeAbiParameters([{ type: 'address' }], [wallet as `0x${string}`]), tableId];
      if (!log || !equal(log.address, config.contract) || !Array.isArray(log.topics) || log.topics.length !== 3 ||
          !topics.every((topic, i) => equal(log.topics[i], topic)) || log.data !== '0x' || log.removed === true ||
          !equal(log.transactionHash, txHash) || !equal(log.blockHash, receipt.blockHash) || log.blockNumber !== receipt.blockNumber) denied(400, 'invalid start event');
      return { blockHash: receipt.blockHash.toLowerCase(), blockNumber: receipt.blockNumber };
    },
  };
}
/** Fixed operator-configured endpoint only; bounded response/deadline, no signing or write RPCs. */
export function createRpc(url: string, signal?: AbortSignal): Rpc {
  return async (method, params) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000), redirect: 'error' });
    if (!response.ok) denied(503, 'RPC unavailable');
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length;
        if (size > 1_000_000) { await reader.cancel(); denied(503, 'RPC response too large'); } chunks.push(r.value); }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (data.error || !Object.hasOwn(data, 'result') || data.id !== 1 || data.jsonrpc !== '2.0') denied(503, 'RPC unavailable');
    return data.result;
  };
}
