import { createPublicClient, createWalletClient, custom, decodeEventLog, http, isAddress, parseAbi, type EIP1193Provider, type Hex } from 'viem';
import { sepolia } from 'viem/chains';

export const registryAbi = parseAbi([
  'function tableCount() view returns (uint256)',
  'function getTable(uint256 id) view returns (address creator, string title, bytes layout, uint64 publishedAt)',
  'function publish(string title, bytes layout) returns (uint256 id)',
  'event TablePublished(uint256 indexed id, address indexed creator, string title, bytes layout)',
]);

export type PublishedTable = { id: bigint; creator: `0x${string}`; title: string; layout: Uint8Array; publishedAt?: bigint };
const ZERO = '0x0000000000000000000000000000000000000000';
const RPC_URL = import.meta.env.VITE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com';
export const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL, { timeout: 12_000 }) });

export function getRegistryAddress(value: string | undefined): `0x${string}` | null {
  if (!value || !isAddress(value) || value.toLowerCase() === ZERO) return null;
  return value as `0x${string}`;
}

function registryAddress(): `0x${string}` {
  const address = getRegistryAddress(import.meta.env.VITE_REGISTRY_ADDRESS);
  if (!address) throw new Error('The Sepolia registry is not deployed/configured yet. Free play still works.');
  return address;
}

export function isRegistryConfigured(): boolean {
  return getRegistryAddress(import.meta.env.VITE_REGISTRY_ADDRESS) !== null;
}

export function validatePublicationTitle(title: string): string | null {
  if (!title.trim()) return 'Enter a table title before publishing.';
  if (title.length > 40) return 'Sepolia titles must be 40 characters or fewer.';
  if (!/^[\x20-\x7e]+$/.test(title)) return 'Sepolia titles must use printable ASCII characters only.';
  return null;
}

export function injectedProvider(): EIP1193Provider {
  if (typeof window === 'undefined') throw new Error('Install a browser wallet to connect.');
  const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) throw new Error('Install a browser wallet to connect. Free play does not require one.');
  return provider;
}

export async function connectWallet(): Promise<{ address: string }> {
  const provider = injectedProvider();
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  const address = accounts?.[0];
  if (!address || !isAddress(address)) throw new Error('No valid wallet account was selected.');
  const chainId = await provider.request({ method: 'eth_chainId' });
  if (chainId !== '0xaa36a7') {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] });
    } catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0xaa36a7', chainName: 'Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [RPC_URL], blockExplorerUrls: ['https://sepolia.etherscan.io'] }] });
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] });
    }
  }
  if (await provider.request({ method: 'eth_chainId' }) !== '0xaa36a7') throw new Error('Switch your wallet to Ethereum Sepolia before publishing.');
  return { address };
}

export function publishedIdFromLogs(logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[], registry: string): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== registry.toLowerCase()) continue;
    try {
      if (!log.topics.length) continue;
      const event = decodeEventLog({ abi: registryAbi, data: log.data, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
      if (event.eventName === 'TablePublished') return event.args.id;
    } catch { /* unrelated log from the same contract */ }
  }
  return null;
}

export async function publishTable(title: string, layout: Uint8Array): Promise<{ hash: string; id: bigint }> {
  const registry = registryAddress();
  const titleError = validatePublicationTitle(title);
  if (titleError) throw new Error(titleError);
  if (layout.length < 10 || layout.length > 37) throw new Error('Finish a valid table before publishing.');
  const { address } = await connectWallet();
  const code = await publicClient.getBytecode({ address: registry });
  if (!code || code === '0x') throw new Error('No Pinball Foundry contract was found at the configured Sepolia address.');
  const walletClient = createWalletClient({ chain: sepolia, transport: custom(injectedProvider()) });
  const bytes = (`0x${Array.from(layout, (n) => n.toString(16).padStart(2, '0')).join('')}`) as Hex;
  const simulation = await publicClient.simulateContract({ address: registry, abi: registryAbi, functionName: 'publish', args: [title, bytes], account: address as `0x${string}` });
  const hash = await walletClient.writeContract(simulation.request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== 'success') throw new Error(`Publication reverted. Inspect ${hash} on Sepolia Etherscan.`);
  const id = publishedIdFromLogs(receipt.logs, registry);
  if (id === null) throw new Error(`Transaction ${hash} succeeded, but no matching TablePublished event was found.`);
  // A receipt is not enough: check the exact record was persisted.
  const result = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: 'getTable', args: [id] });
  if (result[0].toLowerCase() !== address.toLowerCase() || result[1] !== title || result[2].toLowerCase() !== bytes.toLowerCase()) {
    throw new Error(`Transaction ${hash} succeeded but the stored table did not match the submitted table.`);
  }
  return { hash, id };
}

export async function listTables(): Promise<PublishedTable[]> {
  const registry = registryAddress();
  const code = await publicClient.getBytecode({ address: registry });
  if (!code || code === '0x') throw new Error('No Pinball Foundry contract was found at the configured Sepolia address.');
  const count = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: 'tableCount' });
  const first = count > 24n ? count - 24n : 0n;
  const ids = Array.from({ length: Number(count - first) }, (_, i) => count - BigInt(i));
  return Promise.all(ids.map(async (id) => {
    const [creator, title, layout, publishedAt] = await publicClient.readContract({ address: registry, abi: registryAbi, functionName: 'getTable', args: [id] });
    return { id, creator, title, layout: Uint8Array.from(layout.slice(2).match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? []), publishedAt };
  }));
}
