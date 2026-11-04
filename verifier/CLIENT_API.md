# Frontend integration — replay v1

Backend endpoints are relative to the configured verifier base URL; no verifier signing key ever belongs in Vite, browser storage or this repository. `GET /v1/tables` returns `{version:1,ruleset,maxSteps:72000,tables:[{tableId,title,index,variant:"standard",ruleset}]}`. Use these exact table IDs; they bind the frozen engine/layout ruleset, not registry numeric IDs.

## Recording (must integrate in the simulation, not animation frames)

Start with `createGame(TABLES[index].parts, null)`: ONLY official offline **standard** runs qualify. Charged/safe-settlement variants, custom tables, editor changes, restarts and previous rulesets are ineligible. Record every actual 120 Hz `step` invocation, including ready/wait steps (they move flippers); do not record render frames, interpolation or paused time. Before each step, record bitmask `left ? 1 : 0 | right ? 2 : 0` (parenthesize each ternary). A launch event is applied **before** the recorded step at its zero-based `step` index. Quantize the launch power FIRST: `powerMilli=Math.round(clamp(power,0,1)*1000)`; simulate with `launch(game,powerMilli/1000)` and record `power:powerMilli`. Raw fractional browser charge power will not replay identically. Queue asynchronous launch until immediately before the next simulation step. Stop recording exactly at the step that reaches status `over` and lives zero. Max 72,000 steps, exactly three launches. Exceeding the bound invalidates verified submission without stopping local play.

```ts
type Proof = {
  version: 1;
  inputs: number[]; // each integer 0..3; nonempty, <=72000
  launches: {step:number;power:number}[]; // exactly 3, ascending step; power integer 0..1000
};
```

## End-of-run flow (wallet optional until this point)

1. Connect wallet, switch to Ethereum Sepolia (11155111). No wallet message signature is requested by this API; the player signs the final contract transaction.
2. `POST /v1/challenges`, `Content-Type: application/json`, exact JSON `{wallet:"0x…",tableId:"0x…32bytes",variant:"standard"}`. Returns 201 `{version:1,nonce,wallet,tableId,variant,expiresAt,ruleset,maxSteps,domain}`. `expiresAt` is Unix seconds (number), 15 minutes after issue. Challenges may be issued after the run. Fetch tables/ruleset before recording; reject stale recordings.
3. `POST /v1/verify`, exact JSON `{nonce,wallet,tableId,variant:"standard",proof}`. Never send a claimed score, game state, part layout or extra fields.
4. 200 response: `{version:1,attestation,signature,domain,types,steps,call}`. `attestation` contains `{wallet,tableId,score,nonce,expiresAt,proofHash}` with score and expiresAt **decimal strings**. `signature` is actual verifier EIP-712 65-byte hex. Domain `{name:"PinballFoundryLeaderboard",version:"1",chainId:11155111,verifyingContract}`. `types.Score`: `wallet/address,tableId/bytes32,score/uint256,nonce/bytes32,expiresAt/uint64,proofHash/bytes32` in that order. `call={address,chainId,functionName:"submit",args:[attestation,signature]}`.
5. Convert decimal strings to bigint for the ABI tuple. Check configured contract/chain equals response and connected wallet equals attestation wallet. Submit `submit(attestation,signature)` via the wallet using `contracts/PinballFoundryLeaderboard.abi.json`. Wait for success receipt then read `bestScore(tableId,wallet)` and `getLeaderboard(tableId)`. Read-only leaderboard requires no wallet. Top 20 sorted descending, stable ties; per-wallet best persists outside top 20.

Error response `{error:string}`: 400 malformed/binding/unfinished replay; 403 disallowed browser Origin; 404 unknown challenge/path; 405 method; 409 consumed/concurrent/expired-during-verification; 410 expired challenge; 413 body >300000 bytes; 415 non-JSON/compressed; 503 not configured/storage/signing unavailable. Only one concurrent verify wins. Invalid proofs don't consume. A successful verify consumes before replying; store the attestation immediately. A lost successful response cannot be retrieved; request a fresh challenge and reverify the saved recording. Local play must remain available when service is missing. CORS allows one exact origin; no credentials needed. Nonbrowser requests can omit Origin: CORS is not authentication or anti-bot protection.

## Trust/ruleset limits

Replay proves score under accepted inputs, not that a human played, or played in real time. A valid proof can be replayed under a fresh nonce; nonces prevent reusing an attestation, not resubmitting deterministic inputs. Duplicate submissions cannot inflate a wallet's best. The verifier is an explicit trusted signer and no rewards/value should be attached without further threat review. The 15-minute attestation lifetime includes wallet confirmation time. Exact math parity is covered by shared engine imports and tests; cross-browser floating-point boundary divergence remains a real rollout consideration. Backend source hashes freeze ruleset; engine/layout changes require reviewed new hashes/IDs and matching clients, not silently changing existing IDs.
