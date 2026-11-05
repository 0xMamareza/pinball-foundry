import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import App from './App';
import {startRankedRun,invalidateRankedRun,checkRankedService,RankedAdmissionPending,type RankedTicket} from './ranked-client';
import {officialTable} from './score-proof';
import {TABLES} from './layout';
const {wallet}=vi.hoisted(()=>({wallet:'0x1111111111111111111111111111111111111111'}));
vi.mock('./chain',async()=>({...await vi.importActual('./chain'),isRegistryConfigured:()=>false,connectWallet:vi.fn().mockResolvedValue({address:wallet})}));
vi.mock('./ranked-client',async()=>({...await vi.importActual('./ranked-client'),startRankedRun:vi.fn(),invalidateRankedRun:vi.fn(),checkRankedService:vi.fn().mockResolvedValue({confirmations:2})}));
const ticket={wallet,tableId:officialTable(TABLES[0])!.tableId,txHash:'0x01'} as unknown as RankedTicket;
beforeEach(()=>{sessionStorage.setItem('pinball-foundry.warning.v2','accepted');localStorage.clear();history.replaceState(null,'','/');vi.stubEnv('VITE_RANKED_API_URL','https://example.com');vi.stubEnv('VITE_RANKED_START_ADDRESS',wallet);vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Error('offline')));vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();vi.clearAllMocks();sessionStorage.clear();});
async function enterAndConnect(){render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Play now'}));expect((screen.getByRole('button',{name:'Start ranked · Sepolia'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Connect Wallet'}));await waitFor(()=>expect((screen.getByRole('button',{name:'Start ranked · Sepolia'}) as HTMLButtonElement).disabled).toBe(false));}
it('gates ranked before play, locks play while awaiting approval and discards its ticket on restart',async()=>{
 let confirm!:(value:RankedTicket)=>void;vi.mocked(startRankedRun).mockReturnValue(new Promise(resolve=>{confirm=resolve;}));
 await enterAndConnect();fireEvent.click(screen.getByRole('button',{name:'Start ranked · Sepolia'}));
 expect(screen.queryByRole('button',{name:'Launch ball'})).toBeNull();
 expect(screen.getByText(/Waiting for ranked start/)).toBeTruthy();
 confirm(ticket);await waitFor(()=>expect(screen.getByText('RANKED · OFFICIAL STANDARD')).toBeTruthy());
 fireEvent.click(screen.getByRole('button',{name:'Restart run'}));
 expect(invalidateRankedRun).toHaveBeenCalledWith(ticket);expect(screen.queryByText('RANKED · OFFICIAL STANDARD')).toBeNull();
 expect(screen.getByRole('button',{name:'Launch ball'})).toBeTruthy();
});
it('does not reuse a late transaction approval after changing tables or leaving',async()=>{
 let confirm!:(value:RankedTicket)=>void;vi.mocked(startRankedRun).mockReturnValue(new Promise(resolve=>{confirm=resolve;}));
 await enterAndConnect();fireEvent.click(screen.getByRole('button',{name:'Start ranked · Sepolia'}));
 fireEvent.click(screen.getByRole('button',{name:/Midnight Assembly/}));confirm(ticket);
 await waitFor(()=>expect(invalidateRankedRun).toHaveBeenCalledWith(ticket));
 expect(screen.queryByText('RANKED · OFFICIAL STANDARD')).toBeNull();
 expect(screen.getByRole('button',{name:'Launch ball'})).toBeTruthy();
});
it('offers same-start admission retry without sending another wallet transaction',async()=>{
 const retry=vi.fn().mockResolvedValue(ticket);vi.mocked(startRankedRun).mockRejectedValueOnce(new RankedAdmissionPending(retry));
 await enterAndConnect();fireEvent.click(screen.getByRole('button',{name:'Start ranked · Sepolia'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Retry same ranked start · no wallet'})).toBeTruthy());
 expect((screen.getByRole('button',{name:'Start ranked · Sepolia'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Retry same ranked start · no wallet'}));
 await waitFor(()=>expect(screen.getByText('RANKED · OFFICIAL STANDARD')).toBeTruthy());
 expect(startRankedRun).toHaveBeenCalledOnce();expect(retry).toHaveBeenCalledOnce();
});
it('keeps ranked disabled when compatible service metadata cannot be verified',async()=>{
 vi.mocked(checkRankedService).mockRejectedValueOnce(Error('Incompatible service'));
 render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Play now'}));
 await waitFor(()=>expect(screen.getByText(/Incompatible service/)).toBeTruthy());
 expect((screen.getByRole('button',{name:'Start ranked · Sepolia'}) as HTMLButtonElement).disabled).toBe(true);
});
