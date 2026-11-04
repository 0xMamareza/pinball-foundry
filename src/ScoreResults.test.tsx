import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import ScoreResults from './ScoreResults';
import {TABLES} from './layout';
import {officialTable} from './score-proof';
import {connectWallet} from './chain';
vi.mock('./chain',async()=>({...await vi.importActual('./chain'),connectWallet:vi.fn().mockRejectedValue(Error('Install a browser wallet to connect.'))}));
const tableId=officialTable(TABLES[0])!.tableId;
const result={score:250,tableId,proof:{version:1 as const,inputs:[0],launches:[{step:0,power:1000}]},reason:''};
beforeEach(()=>{vi.stubEnv('VITE_SCORE_VERIFIER_URL','');vi.stubEnv('VITE_LEADERBOARD_ADDRESS','');});
afterEach(()=>{cleanup();vi.unstubAllEnvs();vi.clearAllMocks();});
it('does not offer a wallet action until the game has finished',()=>{
 render(<ScoreResults result={null} tableId={tableId} title="Copperwheel Works"/>);
 expect(screen.queryByRole('button',{name:/Connect.*verify/i})).toBeNull();
 expect(connectWallet).not.toHaveBeenCalled();
 expect(screen.getByText(/Leaderboard not deployed \/ configured/)).toBeTruthy();
});
it('shows game-generated local result but disables verification honestly when unconfigured',()=>{
 render(<ScoreResults result={result} tableId={tableId} title="Copperwheel Works"/>);
 expect(screen.getByRole('heading',{name:'Shift complete'})).toBeTruthy();
 expect(screen.getByLabelText('Final local score').textContent).toBe('250');
 expect((screen.getByRole('button',{name:'Connect wallet & verify replay'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.queryByRole('spinbutton')).toBeNull();
 expect(screen.getByText(/not submitted onchain/i)).toBeTruthy();
});
it('explains charged and custom ineligibility without opening a wallet',()=>{
 render(<ScoreResults result={{...result,tableId:null,proof:null,reason:'Custom and settlement-charged runs are local only.'}} tableId={null} title="Custom"/>);
 expect(screen.getByText(/Custom and settlement-charged/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Connect wallet & verify replay'})).toBeNull();
});
it('preserves the final score after a no-wallet error and never reports a transaction',async()=>{
 vi.stubEnv('VITE_SCORE_VERIFIER_URL','https://verify.example');vi.stubEnv('VITE_LEADERBOARD_ADDRESS','0x1111111111111111111111111111111111111111');
 render(<ScoreResults result={result} tableId={tableId} title="Copperwheel Works"/>);
 fireEvent.click(screen.getByRole('button',{name:'Connect wallet & verify replay'}));
 await waitFor(()=>expect(screen.getByText(/Install a browser wallet/)).toBeTruthy());
 expect(screen.getByLabelText('Final local score').textContent).toBe('250');
 expect(screen.queryByRole('button',{name:/Submit score/})).toBeNull();
});
