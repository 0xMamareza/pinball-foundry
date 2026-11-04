# Serverless verifier deployment prerequisites (not deployed)

This directory implements a Cloudflare Worker + D1 backend. No VPS, persistent Node server, relayer funds or player account is required. The browser plays locally; at the end a player may request a verified receipt and sign a Sepolia score transaction. See [CLIENT_API.md](CLIENT_API.md) for the exact integration contract and recording requirements.

## Local verification

Use a current Node with `node:sqlite` (tested Node 26.7.0), npm and Foundry in `~/.foundry/bin` (tested solc 0.8.30). From repository root:

```sh
npm --prefix verifier ci
npm --prefix verifier test
npm --prefix verifier run typecheck
forge test --root contracts --summary
# bundle runs the unit tests, strict TS check and source hash guard first; no upload
WRANGLER_SEND_METRICS=false npm --prefix verifier run bundle
npm --prefix verifier run test:local
```

`test:local` requires the dry bundle and compiled contract artifacts first. It starts **only loopback** Anvil on a dynamic port with Sepolia's chain ID, sets an ephemeral balance for a clearly marked disposable player key, runs the real Worker under workerd with local D1, verifies a completed run, races duplicate submissions, sends an actual local contract transaction, checks Solidity/viem digest equality, and reads back best score, top leaderboard and nonce. It disposes workerd and stops its own Anvil child in `finally`. This is not Sepolia deployment proof. Never fund or use the test keys outside disposable chains. Miniflare 5's published V4 config converter is used for the pinned SDK.

## Before any public deployment (requires separate authorization)

1. Obtain a Cloudflare account, your HTTPS frontend origin and a Worker HTTPS route/domain. Create a D1 database and replace the placeholder database ID in `wrangler.jsonc`. Apply `migrations/0001.sql` to the selected database via reviewed D1 migrations. No fallback store is allowed; missing storage/signing config fails closed.
2. Generate a dedicated production verifier signing key in a secure secret-management workflow. It must be a **separate, unfunded attestation-only EOA**, not a user wallet, deployer or test key. Derive and review its public address; deploy `PinballFoundryLeaderboard` on Ethereum Sepolia with exactly that immutable address as its constructor argument, using an independently authorized deployer. Verify source/bytecode and read `verifier()` onchain. Contract has no admin, upgradeability, withdrawal or token/reward logic. Rotating a compromised immutable signer requires a new contract and frontend configuration; keep this limitation in operational planning.
3. Set nonsecret `VERIFIER_ADDRESS`, deployed `LEADERBOARD_ADDRESS`, `CHAIN_ID="11155111"`, and exact `ALLOWED_ORIGIN` (`https://host`, no path/trailing slash). Set only the private key through **Worker secrets** (for example `wrangler secret put VERIFIER_PRIVATE_KEY` interactively outside chat). Do not put it in wrangler vars, source, logs, shell arguments, `.env` exposed to Vite, `VITE_*`, public CI artifacts or this documentation. Local `.dev.vars` is ignored; production secrets never belong there. Zero-address placeholders deliberately fail closed. Production chain ID is pinned; the smoke uses an isolated node with that same ID, not a remote RPC.
4. Configure abuse controls at the edge: per-IP request limits for challenge issuance and verification, account/tenant budget alerts, and request/CPU limits. CORS rejects nonmatching browser origins but is **not authentication**; direct clients can omit/spoof Origin. This backend does not prove humanity or stop scripted gameplay. There are no prizes, payments or anti-cheat claims beyond deterministic replay. Set a paid/appropriate Worker CPU allowance only after benchmarking full 72,000-step workloads under the chosen plan; free-tier CPU capacity is **not certified** by local tests. The API bounds JSON bytes (300,000), step count, launch count and field values. An attacker can still repeatedly submit bounded workloads.
5. Periodically delete expired challenges using the indexed `expires_at` column (e.g. a reviewed scheduled D1 maintenance task: `DELETE FROM challenges WHERE expires_at <= unixepoch()`). D1 retention/quotas and monitoring need operational ownership. D1 verification consumes via one conditional `UPDATE ... consumed=0 AND expires_at>now`, so concurrent isolates cannot both return authorization. Invalid proofs do not consume. Store successful receipts client-side; a dropped successful HTTP response cannot be retrieved and a fresh challenge is necessary. No server signing key or stack trace is returned.
6. Run the full gates above, confirm unchanged engine/layout hashes, review [CLIENT_API.md](CLIENT_API.md), integrate exact per-step recording and quantized launch simulation in the frontend, and separately authorize Worker/contract deployment. Public deployment commands intentionally are not npm scripts. Wrangler workers.dev and preview URLs are disabled by default; a reviewed production route is required. After authorized deployment, verify exact deployed contract code/signer/domain, real D1 configuration, CORS headers and successful end-to-end Sepolia readback before labeling the leaderboard live.

## Security and scope

Only official tables, frozen engine/layout hashes, offline standard variant, a complete three-ball game and engine-reconstructed score are accepted. No claimed score or arbitrary game state is trusted. Table IDs incorporate the ruleset and part layout; changed rules need new IDs. EIP-712 binds wallet/table/score/nonce/expiry/proof hash to chain ID and exact contract. Solidity requires the wallet as transaction sender, verifies canonical ECDSA against the immutable verifier, rejects expired/reused nonces, preserves per-wallet best and exposes bounded top-20 reads.

The server is a trusted verifier, **not a trustless ZK proof**. Anyone controlling its signing key can authorize scores. Recorded inputs may be generated by bots or reused with fresh nonces; replay protection prevents attestation reuse, not reuse of a valid input trace. Scores cannot compound, since best is max-only. Wallets/signatures are public onchain. No full player replay is persisted by the Worker; only challenge bindings/expiry/consumed flags are stored. Local successful integration is not a public security audit, production capacity test, cross-browser numerical certification or proof a human played the game.
