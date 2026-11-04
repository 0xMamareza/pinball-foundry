import { type Address, type Hex } from 'viem';
export const scoreTypes = { Score: [
  { name: 'wallet', type: 'address' }, { name: 'tableId', type: 'bytes32' },
  { name: 'score', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
  { name: 'expiresAt', type: 'uint64' }, { name: 'proofHash', type: 'bytes32' },
] } as const;
export function scoreDomain(chainId: number, verifyingContract: Address) {
  return { name: 'PinballFoundryLeaderboard', version: '1', chainId, verifyingContract } as const;
}
export type Attestation = { wallet: Address; tableId: Hex; score: bigint; nonce: Hex; expiresAt: bigint; proofHash: Hex };
