# Ranked v2 integration contract — local, OFFCHAIN scores

**Selected product path:** wallet-free practice; only official, standard, uncharged ranked runs use ONE pre-play Ethereum Sepolia transaction. Final scores are replay-verified and saved automatically to private VPS SQLite. No postgame transaction, no relayer, no backend signer, and **scores are not onchain**. Legacy `/v1/*`, `PinballFoundryLeaderboard.submit`, and `src/score-chain.ts` attestation flow are not compatible with this path.

The selected ranked-start contract is deployed on Sepolia at `0x621A6b79Eb6eac51bDE51e6AfACA60716C6B3554`; the Node/SQLite v2 service exposes endpoints such as `https://squeekpinball.xyz/v2/tables`. A real start transaction and a replay-verified offchain score were read back on the public leaderboard. This describes the observed deployment, not a security audit, continuous availability guarantee or authorization for another wallet action. A local build must still configure and verify its own matching API/contract before enabling ranked mode.

## Wallet sequence and required extra signature

1. Connect an EOA wallet on **Ethereum Sepolia `11155111` (`0xaa36a7`)**. Recommend a disposable burner/test wallet and disclose unaudited contracts/testnet gas. Practice never requires a wallet.
2. `GET /v2/tables`; require the exact locally supported ruleset/table IDs and operator-configured start contract. Do not use charged/custom boards. The two deployment constructor arguments must be these two table IDs (not title/index/custom layout IDs).
3. Call the nonpayable `startRun(bytes32 tableId)` at that contract, **value 0**, once. Its only event is `RunStarted(address indexed wallet, bytes32 indexed tableId)`. Wait for the advertised confirmations (default 3).
4. **One free offchain `personal_sign` approval is also required before play.** Sign the exact message below with that same wallet. This is NOT another transaction and is never needed after the game. A public transaction hash alone cannot authenticate the player: omitting this signature would let anyone steal another player's run/nonce. EIP-1271 smart-contract wallets are not supported by this release. Never imply there is only one wallet prompt.
5. `POST /v2/runs` with the binding and signature. Start simulation only after HTTP 201 and preserve its nonce as a private bearer capability. A retried identical authorized start returns the same nonce and original expiry; it never resets the clock.
6. Record the unchanged deterministic v1 replay proof on the official table initialized with **no charged bumper**, fixed 120 Hz simulation, standard variant. After all three balls finish, automatically `POST /v2/scores` using the saved nonce/txHash, proof and displayed score. No signing or wallet transaction here.
7. Display verified OFFCHAIN receipt and refetch `/v2/leaderboard?tableId=...`. On transient failure retain the exact submission for retry; do not label it saved until HTTP 200. An identical retry is idempotent even after backend restart. Do not display a pending/local score as a verified result.

### Exact authorization message

UTF-8 text, LF separators, **no trailing newline**. Lowercase wallet/contract and lowercase transaction/table/ruleset hashes. `ruleset` comes from `/v2/tables`; reject an unsupported value, do not blindly adopt arbitrary rulesets.

```text
Pinball Foundry ranked start v2
Chain: 11155111
Contract: <lowercase contract>
Wallet: <lowercase wallet>
Table: <tableId>
Transaction: <txHash>
Ruleset: <ruleset>
```

The implementation's authoritative message builder is `startMessage` in `verifier/src/vps/v2/service.ts`. Browser code should reproduce this tiny pure template (do not import the Node service). With viem use `walletClient.signMessage({ account, message })`; with EIP-1193 use standard UTF-8-to-hex `personal_sign` params `[hexMessage, wallet]`. This signature authorizes only this transaction/table/wallet/contract/chain/ruleset, not arbitrary spending. Do not publish/log it or the nonce.

## HTTP endpoints

Root-origin examples are shown. If the reverse proxy strips `/api`, prepend `/api` client-side. All POSTs require uncompressed `Content-Type: application/json`; body <=300000 bytes. Exact fields only; unknown fields rejected. Hashes/nonce are lowercase `0x` + 64 hex digits; signatures are 65-byte hex. Wallet may be checksummed on input; stored/output addresses are lowercase. Origin must be absent (non-browser tooling) or exactly configured; CORS is not authentication.

### `GET /v2/tables` → 200

```ts
{
  version: 2; storage: 'offchain'; ruleset: string; maxSteps: 72000;
  tables: { tableId: string; title: string; index: number; variant: 'standard'; ruleset: string }[];
  chainId: 11155111; startContract: string; confirmations: number;
  authorization: 'personal_sign'; runSeconds: 900;
}
```

### `POST /v2/runs` → 201

```ts
// request
{ wallet: string; tableId: string; txHash: string; signature: string }
// response
{
  version: 2; storage: 'offchain'; nonce: string; wallet: string;
  tableId: string; txHash: string; expiresAt: number; ruleset: string; maxSteps: 72000;
}
```

First admission requires a recent canonical mined transaction (block timestamp within the past 900 seconds, at most 60 seconds future skew), exact calldata/zero value/wallet/destination, real RPC chain ID 11155111, success receipt, the exact single contract event and enough confirmations. Forged/unmined hashes cannot create a run. After wallet authentication, an exact existing active run may be retried after its transaction exceeds 900 seconds: every chain binding, canonical receipt/block and confirmation check still runs, including future-skew rejection, and the block hash/number must match the stored admission. `expiresAt` is first admission time +900 seconds, not a renewed lease on retry. Overlapping requests return the same persisted nonce/expiry; completion or expiry while RPC validation is in flight still returns 409 or 410 respectively. Expired and consumed transaction identities remain tombstones.

### `POST /v2/scores` → 200

```ts
// request (no wallet/table/variant fields: those are immutable server bindings)
{
  nonce: string; txHash: string; score: number;
  proof: { version: 1; inputs: number[]; launches: { step: number; power: number }[] };
}
// receipt
{
  version: 2; storage: 'offchain'; chainId: 11155111; txHash: string;
  wallet: string; tableId: string; score: number; proofHash: string; verifiedAt: number;
}
```

`score` is a nonnegative safe integer, compared against local replay output, never trusted. `inputs` are masks 0..3, exactly one per simulation step, <=72000; exactly three launches with increasing step and integer power 0..1000. An unfinished, trailing-step, charged/custom/malformed proof is rejected. Score/proof hash/consumption are persisted in one immediate SQLite transaction. A duplicate exact replay returns its original receipt; another valid proof for the same start returns 409, never overwrites. Chain receipt/canonical block/confirmations are rechecked on every score attempt, including idempotent retries. A reorg between admission and scoring is rejected.

### `GET /v2/leaderboard?tableId=<official table hash>` → 200

```ts
{ version: 2; storage: 'offchain'; tableId: string; entries: Receipt[] }
```

Up to 20 wallets, best verified score per wallet for the specified table only. Sort: score descending, verified timestamp ascending, transaction hash ascending. No nonce/signature in public results.

### Errors

JSON `{ error: string }`, no stack/paths/RPC credentials:
- 400: malformed binding/proof, extra fields, wrong wallet/table/event/calldata, score mismatch.
- 403: wrong Origin or invalid wallet authorization.
- 404: unknown route/run or wrong bearer nonce.
- 409: unmined/unconfirmed/failed/reorganized start, already completed start, or conflicting submission. For confirmation wait, retry the same start after another block; do not request another wallet transaction automatically.
- 410: expired run or transaction outside admission window; offer practice or an explicit new ranked attempt, never silently send another transaction.
- 413/415: body limit / unsupported content type or compression.
- 421: Host mismatch. 429: global rate budget. 503: storage capacity, chain mismatch/RPC failure or service busy/unavailable.

## Security/operations boundaries

- RPC responses are a trusted operator dependency, not a trustless chain proof. HTTPS is required except loopback local testing. Public free Sepolia RPCs may throttle/disappear; no paid service is required or enabled, and free availability is not guaranteed.
- Confirmations reduce but do not eliminate deep reorg risk. Stored public rows are not continuously rescanned after acceptance; a later deep reorg needs operator review/revalidation. The game is replay-verified, not proof of human play; deterministic prerecorded/bot proofs are not excluded.
- SQLite pins chain/contract/ruleset/table deployment identity; changing these requires a fresh private v2 DB and a reviewed release, not a legacy migration. One writer/process per DB; atomicity covers concurrent requests. Do not restore an old DB snapshot into live admission without an operator-reviewed reconciliation: consumed identities/results can be lost. Retain old snapshots privately; keep admission closed beyond the 900-second chain admission window and all old nonce lifetimes before restoring, and reconcile lost leaderboard rows.
- Capacity defaults to 100000 total starts, including expired/consumed tombstones (configurable max1000000). At capacity admission fails closed; no silent deletion that could reopen an identity. Monitor disk/WAL and capacity.
- No frontend files were changed by the backend worker. Parent owns browser integration and visible end-to-end proof.
