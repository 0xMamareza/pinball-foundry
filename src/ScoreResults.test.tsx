import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import ScoreResults from './ScoreResults';
import {TABLES} from './layout';
import {officialTable} from './score-proof';
import {connectWallet} from './chain';
import {submitRankedScore,type RankedTicket} from './ranked-client';
vi.mock('./ranked-client',()=>({submitRankedScore:vi.fn(),readRankedLeaderboard:vi.fn().mockResolvedValue([])}));
const ticket={wallet:'0x1111111111111111111111111111111111111111',tableId:officialTable(TABLES[0])!.tableId,txHash:'0x02',nonce:'0x03',expiresAt:9999999999} as unknown as RankedTicket;
vi.mock('./chain',async()=>({...await vi.importActual('./chain'),connectWallet:vi.fn()}));
const tableId=officialTable(TABLES[0])!.tableId;
const result={score:250,tableId,proof:{version:1 as const,inputs:[0],launches:[{step:0,power:1000}]},reason:''};
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});
it('automatically records a ranked finish, showing pending then recorded, without a wallet prompt',async()=>{
 let complete!:(value:never)=>void;vi.mocked(submitRankedScore).mockReturnValue(new Promise(resolve=>{complete=resolve;}));
 render(<ScoreResults ticket={ticket} result={result} tableId={tableId} title="Copperwheel Works"/>);
 expect(screen.getByText('Pending · verifying replay')).toBeTruthy();
 expect(submitRankedScore).toHaveBeenCalledWith(ticket,250,result.proof);
 complete({score:250} as never);
 await waitFor(()=>expect(screen.getByText('Recorded · offchain leaderboard')).toBeTruthy());
 expect(connectWallet).not.toHaveBeenCalled();
 expect(screen.queryByRole('button',{name:/wallet|submit|verify/i})).toBeNull();
});
it('retains the local score after recording failure and never calls it recorded',async()=>{
 vi.mocked(submitRankedScore).mockRejectedValueOnce(Error('HTTP 503')).mockResolvedValueOnce({score:250} as never);
 render(<ScoreResults ticket={ticket} result={result} tableId={tableId} title="Copperwheel Works"/>);
 await waitFor(()=>expect(screen.getByText('Unable to record')).toBeTruthy());
 expect(screen.getByLabelText('Final local score').textContent).toBe('250');
 expect(screen.queryByText('Recorded · offchain leaderboard')).toBeNull();
 expect(connectWallet).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Retry recording · no wallet'}));
 await waitFor(()=>expect(screen.getByText('Recorded · offchain leaderboard')).toBeTruthy());
 expect(submitRankedScore).toHaveBeenCalledTimes(2);expect(connectWallet).not.toHaveBeenCalled();
});
it('explains practice before finish and never offers old postgame wallet actions',()=>{
 render(<ScoreResults result={null} tableId={tableId} title="Copperwheel Works"/>);
 expect(screen.getByText(/Practice scores are local to this run/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:/wallet|submit|verify/i})).toBeNull();
});
it('shows every finished score and honest local status with optional HTTPS sharing',()=>{
 render(<ScoreResults result={result} tableId={tableId} title="Copperwheel Works"/>);
 expect(screen.getByRole('heading',{name:'Shift complete'})).toBeTruthy();
 expect(screen.getByLabelText('Final local score').textContent).toBe('250');
 expect(screen.getByText('Practice · local result')).toBeTruthy();
 const x=screen.getByRole('link',{name:'Share on X'}) as HTMLAnchorElement;
 expect(new URL(x.href).origin).toBe('https://twitter.com');
 expect(decodeURIComponent(x.href)).not.toMatch(/0x|verified|rank #|onchain/i);
 expect(screen.getByRole('link',{name:'Share on Telegram'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:/wallet|submit|verify/i})).toBeNull();
 expect(connectWallet).not.toHaveBeenCalled();
});
it('copies only public score text, without URL fragments or private account data',async()=>{
 const copy=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{value:{writeText:copy},configurable:true});
 history.replaceState(null,'','/#table=private-blueprint');
 render(<ScoreResults result={result} tableId={tableId} title="Copperwheel Works"/>);
 fireEvent.click(screen.getByRole('button',{name:'Copy result'}));
 await waitFor(()=>expect(copy).toHaveBeenCalledOnce());
 expect(copy.mock.calls[0][0]).toContain('250');expect(copy.mock.calls[0][0]).not.toMatch(/private-blueprint|#table|0x/);
 expect(screen.getByText('Result copied.')).toBeTruthy();
});
it('offers selectable text when clipboard access is unavailable',async()=>{
 Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});
 render(<ScoreResults result={result} tableId={tableId} title="Copperwheel Works"/>);
 fireEvent.click(screen.getByRole('button',{name:'Copy result'}));
 const fallback=await screen.findByRole('textbox',{name:'Select result text to copy'}) as HTMLTextAreaElement;
 expect(fallback.value).toContain('250');
 expect(fallback.value).not.toMatch(/0x|nonce|signature|#table/);
 expect(document.activeElement).toBe(fallback);
 expect(fallback.selectionStart).toBe(0);
 expect(fallback.selectionEnd).toBe(fallback.value.length);
});
it('shows custom or charged result reasons, never inventing an online rank',()=>{
 render(<ScoreResults result={{...result,tableId:null,proof:null,reason:'Custom and settlement-charged runs are practice only.'}} tableId={null} title="Custom"/>);
 expect(screen.getByText(/Custom and settlement-charged/)).toBeTruthy();
 expect(screen.getByLabelText('Final local score').textContent).toBe('250');
 expect(screen.queryByText(/rank #|recorded offchain/i)).toBeNull();
});
