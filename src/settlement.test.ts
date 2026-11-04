import { expect,it } from 'vitest';
import { selectSettlement, OFFLINE_VARIANT } from './settlement';
const hash='0x'+'a'.repeat(64);
const sample={status:'available',chain:{target:'sepolia',chainId:'11155111',safeThroughBlock:'200',confirmations:'12'},recentSettlements:[{transactionHash:hash,settledThroughRound:'1246',workAdded:'443',ethereumBlockNumber:'199',confirmationStatus:'safe'}]};
it('only uses safe Sepolia settlements; malformed, unavailable or unconfirmed data stays offline',()=>{
  const selected=selectSettlement(sample);
  expect(selected.status).toBe('safe');expect(selected.round).toBe('1246');
  expect(selected.source).toBe('https://sepolia.etherscan.io/tx/'+hash);
  expect(selected.palette).toBe(Number(443n%3n));
  for(const data of [null,{}, {...sample,status:'unavailable'}, {...sample,chain:{...sample.chain,chainId:'1'}}, {...sample,recentSettlements:[{...sample.recentSettlements[0],confirmationStatus:'pending'}]}, {...sample,recentSettlements:[{...sample.recentSettlements[0],transactionHash:'0xbad'}]}, {...sample,recentSettlements:[{...sample.recentSettlements[0],workAdded:'nope'}]}, {...sample,recentSettlements:[{...sample.recentSettlements[0],ethereumBlockNumber:'201'}]}]) expect(selectSettlement(data)).toEqual(OFFLINE_VARIANT);
});
