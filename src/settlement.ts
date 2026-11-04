export type Variant={status:'offline'|'safe';palette:number;round:string|null;source:string};
export const SETTLEMENT_API='https://api.squeekchain.com/v1/settlements?range=24h';
export const OFFLINE_VARIANT:Variant={status:'offline',palette:0,round:null,source:'https://docs.squeekchain.com/developers/api/'};
export function selectSettlement(data:unknown):Variant {
 if(!data || typeof data!=='object')return OFFLINE_VARIANT;
 const d=data as Record<string,unknown>, chain=d.chain as Record<string,unknown>|undefined;
 if(d.status!=='available' || !chain || chain.chainId!=='11155111' || chain.target!=='sepolia' || typeof chain.safeThroughBlock!=='string' || !/^\d+$/.test(chain.safeThroughBlock) || !Array.isArray(d.recentSettlements))return OFFLINE_VARIANT;
 for(const item of d.recentSettlements){
  if(!item || typeof item!=='object')continue;
  const s=item as Record<string,unknown>;
  if(!['safe','confirmed'].includes(s.confirmationStatus as string) || typeof s.transactionHash!=='string' || !/^0x[0-9a-fA-F]{64}$/.test(s.transactionHash) || typeof s.settledThroughRound!=='string' || !/^\d+$/.test(s.settledThroughRound) || typeof s.workAdded!=='string' || !/^\d+$/.test(s.workAdded) || typeof s.ethereumBlockNumber!=='string' || !/^\d+$/.test(s.ethereumBlockNumber) || BigInt(s.ethereumBlockNumber)>BigInt(chain.safeThroughBlock))continue;
  return {status:'safe',palette:Number(BigInt(s.workAdded)%3n),round:s.settledThroughRound,source:'https://sepolia.etherscan.io/tx/'+s.transactionHash};
 }
 return OFFLINE_VARIANT;
}
