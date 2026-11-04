import { describe, expect, it } from 'vitest';
import { encodeEventTopics, encodeAbiParameters } from 'viem';
import { connectWallet, getRegistryAddress, publishedIdFromLogs, registryAbi, validatePublicationTitle } from './chain';

describe('registry boundary', () => {
  it('requires a title accepted by the Sepolia contract before opening the wallet', () => {
    expect(validatePublicationTitle('Copper Wheel')).toBeNull();
    expect(validatePublicationTitle('a'.repeat(40))).toBeNull();
    expect(validatePublicationTitle('a'.repeat(41))).toMatch(/40/);
    expect(validatePublicationTitle('⚡ Foundry')).toMatch(/ASCII/);
    expect(validatePublicationTitle('  ')).toMatch(/title/i);
  });
  it('rejects missing and invalid registry addresses', () => {
    expect(getRegistryAddress('')).toBeNull();
    expect(getRegistryAddress('0xnotanaddress')).toBeNull();
    expect(getRegistryAddress('0x0000000000000000000000000000000000000000')).toBeNull();
  });
  it('decodes the published id only from a receipt emitted by our registry', () => {
    const registry = '0x1111111111111111111111111111111111111111' as const;
    const creator = '0x2222222222222222222222222222222222222222' as const;
    const event = registryAbi.find((item) => item.type === 'event' && item.name === 'TablePublished')!;
    const topics = encodeEventTopics({ abi: [event], eventName: 'TablePublished', args: { id: 42n, creator } }) as readonly `0x${string}`[];
    const data = encodeAbiParameters([{ type: 'string' }, { type: 'bytes' }], ['Test table', '0x03006464017878028c8c']);
    expect(publishedIdFromLogs([{ address: registry, topics, data }], registry)).toBe(42n);
    expect(publishedIdFromLogs([{ address: creator, topics, data }], registry)).toBeNull();
    expect(publishedIdFromLogs([], registry)).toBeNull();
  });
  it('reports a wallet installation requirement instead of inventing a connected account', async () => {
    await expect(connectWallet()).rejects.toThrow(/wallet/i);
  });
});
