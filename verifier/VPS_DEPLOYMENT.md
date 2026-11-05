# VPS deployment runbook — historical examples, not production config

This document was written before the v2 release. The selected Node/SQLite v2 service, Sepolia ranked-start contract, Squeek-only Caddy site and HTTPS are now live; see the repository README and `V2_API.md` for current scope. The commands, hostnames and values below remain **illustrative historical examples**, not a dump of production configuration or instructions to redeploy. Do not run privileged examples until the operator reviews isolated paths, ports, domain, contract addresses, resource budget and rollback. Do not change Rialo Arena, its database, its service or its Caddy site.

## Selected release: ranked v2, no backend signer

**The selected product path is v2.** The `/v1/*` signer/postgame-onchain implementation and examples later in this document are retained only as **LEGACY reference**, not the selected release. Do not deploy the old signer flow for pre-play ranked runs. The v2 contract/service are live; the sample deployment steps below do not describe the exact installed files.

- Contract: `contracts/src/PinballFoundryRankedStart.sol`; constructor takes the exact two pinned table IDs returned by `/v2/tables`, in official table order. `startRun(bytes32)` is nonpayable and emits the caller/table only; no owner, relayer, service fee or backend signing key.
- Build from `verifier/` on Node24.20.0/npm11.19.0: **`npm run bundle:vps:v2`**. Release the entire **`verifier/dist/vps-v2/`** payload, not `dist/vps/`. Both paths retain complete license notices/manifest. `npm run bundle:vps` remains legacy and `npm run bundle` remains a Cloudflare dry run only.
- API, exact signed authorization text, replay schema, retry semantics and frontend sequence: **[V2_API.md](V2_API.md)**. Practice stays wallet-free; ranked has ONE pre-play Sepolia transaction **plus one free pre-play offchain message signature** (needed to prevent stealing public transaction hashes). Scores persist automatically OFFCHAIN after replay; no postgame wallet approval/transaction. UI must disclose the two different wallet prompts, unaudited contracts and testnet gas.
- Illustrative v2 configuration (placeholders only, not production values):

```ini
HOST=127.0.0.1
PORT=3218
DATABASE_PATH=/var/lib/pinball-foundry/ranked-v2.sqlite
ALLOWED_ORIGIN=https://game.example
CHAIN_ID=11155111
START_CONTRACT_ADDRESS=<reviewed-deployed-ranked-start-address>
SEPOLIA_RPC_URL=<operator-reviewed-https-sepolia-read-rpc-url>
CONFIRMATIONS=3
MAX_RUNS=100000
```

`START_CONTRACT_ADDRESS` must be nonzero. `SEPOLIA_RPC_URL` is a fixed operator endpoint, HTTPS except loopback testing, no URL credentials/fragment or redirects, five-second RPC deadline and 1MB response bound. Real chain ID is checked on every admitted start/score, not merely accepted from config. Only chain read methods are used; there is no signing or transaction broadcast. Free public RPC may be throttled/unavailable; no new paid service is enabled. Only a free endpoint is permitted under the current cost constraint: if it is unavailable, leave ranked unavailable rather than enabling a paid plan.

`CONFIRMATIONS` range1–128, default3. `MAX_RUNS` range1–1000000, default100000. All shared transport variables/limits below apply to v2 except `MAX_CHALLENGES`; default v2 port is3218. Do **not** set `VERIFIER_PRIVATE_KEY`, `VERIFIER_PRIVATE_KEY_FILE`, `VERIFIER_ADDRESS` or `LEADERBOARD_ADDRESS`: v2 rejects legacy signer configuration. V2's CLI rejects unsupported Node versions and uses `umask(0077)`; create state/backup directories with mode0700 and keep SQLite/WAL/SHM away from the static site. Never reuse the legacy v1 DB or a Rialo DB. V2 requires its exact schema/user_version2 and pins the chain, start contract, replay ruleset and official table IDs; mismatches fail startup.

Every start identity (including expired/consumed) is retained to prevent reuse; capacity exhaustion fails admission503, never silently purges a run. A run lasts900 seconds. Successful replay stores computed score/proof hash and consumes the nonce/run in a single `BEGIN IMMEDIATE` SQLite transaction; duplicates are idempotent, competing valid proofs conflict. The public board selects the best score per wallet/table and returns20 entries, never nonces/signatures. Chain evidence is rechecked at finish; later deep reorgs are an operator review/revalidation concern, not solved by three confirmations.

For a later approved systemd deployment, adapt the legacy isolation/hardening template below to a **separate reviewed v2 unit**, the v2 payload and v2 environment file. **Remove both `LoadCredential=...` and `Environment=VERIFIER_PRIVATE_KEY_FILE=...`; do not generate any key.** Use the selected v2 file's `server.mjs` as `ExecStart` and retain the private service account, resource limits and UMask0077. Example routing for the NEW site only (preserve Rialo unchanged):

```caddyfile
handle_path /api/* {
    reverse_proxy 127.0.0.1:3218
}
handle /v2/* {
    reverse_proxy 127.0.0.1:3218
}
# Follow with the separate static-site handler; do not route unknown API calls to the SPA.
```

The parent frontend must explicitly use `/v2/*` and the new start ABI; legacy `src/score-chain.ts` appends `/v1` and is NOT compatible. For a same-origin root API base the proxy preserves `/v2`; for `/api` the proxy strips that prefix. Keep Host and exact Origin protection.

Backup via SQLite's consistent online backup API, not copying a live database without WAL. Retain transaction tombstones and latest results. An old snapshot can lose consumed identities and scores: keep admission offline beyond both the900-second transaction admission window and outstanding nonce lifetime before restoration, then reconcile missing results before claiming board continuity. Code rollback must retain a compatible v2 DB/config; never start legacy v1 against it. V2 shutdown aborts outstanding RPCs, bounds slow uploads and closes SQLite; no signing material to back up or rotate. No load, public RPC availability, external audit, live backup recovery or deployment sign-off is implied by local tests.

## LEGACY v1 reference — not the selected ranked release

Everything below describes the previous postgame attestation/onchain contract path. Retained for compatibility/testing only. Do not use these signer credentials, `/v1` proxy or `scores.sqlite` examples for the selected v2 service.

## Runtime and release prerequisites

- **Node.js 24.20.0**, npm **11.19.0**, Linux x86-64 for the intended host. The CLI accepts Node 24.20+ within major 24 and fails startup on other majors. Node's built-in `node:sqlite` is used; there is no native SQLite npm dependency or runtime `npm install`.
- Build on a trusted machine from the full repository, not just `verifier/`: replay imports `src/engine.ts` and `src/layout.ts`. The existing source-hash tests must pass. Preserve LF bytes (`git -c core.autocrlf=false archive ...` when exporting on Windows). Do not change the ruleset or source pins to hide a mismatch.
- An operator-controlled domain with correct DNS and HTTPS, separately authorized public Sepolia registry/leaderboard deployments, the deployed leaderboard's exact verifier address, an unprivileged service account, an approved free loopback port, and privileged assistance for systemd/Caddy are still required. Addresses in the examples are placeholders, not deployed contracts.
- Check current disk/RAM/CPU, existing service health and ports before a later deployment. Prior capacity observations are not a load guarantee. No `sudo -n`, purchase, account, key or wallet action is assumed available.

From `verifier/`, with the pinned Node/npm on PATH:

```sh
node --version                 # v24.20.0
npm --version                  # 11.19.0
npm ci --include=dev --ignore-scripts
npm run bundle:vps             # all verifier tests, strict tsc, production bundle
npm run bundle                 # original Cloudflare dry-run path, NOT a deploy
npm run test:local             # optional local workerd+D1+Anvil; needs existing Solidity artifacts/Anvil
```

The release payload is **`verifier/dist/vps/`**: `server.mjs`, its esbuild `.LEGAL.txt`, complete `THIRD_PARTY_NOTICES.txt` for every bundled npm package, and `manifest.json` with artifact/notice hashes and package names. The JavaScript embeds the migration, replay engine, tables and signing dependencies; it runs without `node_modules`, the repository or an external migration file. Keep the entire payload (including notices), release manifests, licenses and a source revision/diff with every release. Build frontend static files separately; never put signer material in a Vite variable or static release.

Local source tests, independent subprocess restart tests and an isolated Linux clean-install rebuild are recorded in [VPS_VALIDATION.md](VPS_VALIDATION.md). Local verification is not live service certification.

## Configuration: fail closed, file-only signer

All values below are nonsecret **except the contents of the key file**. Required variables:

| Variable | Required value |
| --- | --- |
| `ALLOWED_ORIGIN` | Exact canonical origin, e.g. `https://game.example`, no trailing slash/path/query/credentials. HTTP only for loopback local testing. |
| `CHAIN_ID` | `11155111` only (Ethereum Sepolia). |
| `LEADERBOARD_ADDRESS` | Nonzero deployed Sepolia leaderboard address; verify bytecode and its exact immutable verifier separately. |
| `VERIFIER_ADDRESS` | Address derived from the dedicated verifier signing key; must match the key file and deployed contract. |
| `VERIFIER_PRIVATE_KEY_FILE` | Absolute path to a regular, nonsymlink, <=100-byte file holding one hex private key. POSIX mode must exclude all group/other access (0400 or 0600). |
| `DATABASE_PATH` | Absolute path to a persistent SQLite file in this service's private state directory, never `:memory:` or a Rialo path. Parent directory must already exist. |

`VERIFIER_PRIVATE_KEY` in the environment is deliberately rejected. Do not pass keys in arguments, chat, terminal history, frontend config, Git, logs or CI output. Generate/store a dedicated unfunded signing key through the operator's approved secure workflow, never reuse a wallet/funded key or the public deterministic test key. Secure its parent directory (0700), file and encrypted offline backup. This implementation holds the key in process memory; root or the service account can read it. Isolating the account is mandatory. Windows tests do not certify Windows ACL handling; the production target is Linux.

Optional bounded settings (invalid syntax/ranges fail startup):

| Variable | Default | Range/meaning |
| --- | ---: | --- |
| `HOST` | `127.0.0.1` | **Only this exact IPv4 loopback literal is accepted.** No public or hostname bind. |
| `PORT` | 3217 | 0–65535; 0 is for disposable local tests only. Check an actual fixed production port is free. |
| `RATE_LIMIT` | 120 | 1–10000 tokens, one global token bucket across all requests. |
| `RATE_WINDOW_MS` | 60000 | 100–3600000; bucket refill period. |
| `MAX_INFLIGHT` | 4 | 1–16 admitted requests, including uploads/replay/signing; no unbounded job queue. |
| `MAX_CONNECTIONS` | 32 | 1–128 total TCP connections, including incomplete headers. |
| `BODY_TIMEOUT_MS` | 10000 | 100–30000, absolute body receive deadline. |
| `MAX_CHALLENGES` | 20000 | 1–100000 rows, including live consumed rows. SQL trigger enforces admission capacity. |
| `CLEANUP_INTERVAL_MS` | 60000 | 100–300000, expired-only cleanup; also runs at startup. |
| `SHUTDOWN_TIMEOUT_MS` | 5000 | 100–30000, then terminate remaining HTTP sockets and finish handlers before closing SQLite. |

Fixed transport bounds: 300000 body bytes including chunked requests, 8192 header bytes, 10s header deadline (Node checks every 1s), 1s keepalive, 100 requests/socket, finite request/socket deadlines. Oversized declared or actual bodies are rejected without waiting for the upload terminator; rejected uploads close the connection. Normal replay/attestation schemas, rulesets, 15-minute challenge expiry, EIP-712 domain and single conditional challenge consumption are the unchanged Worker handler's behavior.

The global limiter intentionally ignores `X-Forwarded-For`, `CF-Connecting-IP`, `Forwarded`, `X-Forwarded-Host` and `X-Forwarded-Proto`. A forged IP cannot buy a fresh budget. This trades fairness for a fixed memory budget: one attacker can exhaust everybody's allowance. Origin checks are not authentication; scripts can omit/forge Origin. Use separately reviewed edge abuse protection if needed. Host must exactly equal `ALLOWED_ORIGIN`'s host (including a nondefault port); duplicate Host headers are rejected. Never expose the backend port or trust arbitrary proxy headers as authority.

SQLite uses WAL, `synchronous=FULL`, a 2s busy timeout and bounded WAL checkpoint settings. Startup migrates **only an empty version-0 database**, validates the exact version-1 schema and `quick_check`, and refuses unknown versions/schema drift/corruption. The original `migrations/0001.sql` is embedded unchanged. Cleanup never deletes a still-live consumed nonce. Cleanup failure disables all routes until a reviewed restart; storage/write failures never issue a signed success response. Run **one service process and one writer per database**, not a cluster/PM2 multiworker deployment. Unexpected power loss, full disk and backup restoration still require operational handling.

## Isolated layout and systemd example

Proposed layout (review; none created on the VPS):

```text
/srv/pinball-foundry/releases/<release-id>/verifier/   # immutable dist/vps payload
/srv/pinball-foundry/releases/<release-id>/site/       # separately built Vite files
/srv/pinball-foundry/current                         # atomic release symlink
/etc/pinball-foundry/verifier.env                    # nonsecret configuration only
/etc/pinball-foundry/verifier-key                    # root-only credential source
/var/lib/pinball-foundry/scores.sqlite               # service-owned state, 0700 directory
/var/backups/pinball-foundry/                        # private backups, NOT a static site
```

Use a dedicated locked-down `pinball-foundry` OS account/group. Static files need only Caddy read access; Caddy must not read the state, credential or backup directories. Keep old immutable releases for rollback. Do not reuse Rialo's working directory, user, Node process, DB, port or service unit.

Example `/etc/pinball-foundry/verifier.env` (replace placeholders through the operator's nonsecret config workflow):

```ini
HOST=127.0.0.1
PORT=3217
DATABASE_PATH=/var/lib/pinball-foundry/scores.sqlite
ALLOWED_ORIGIN=https://game.example
CHAIN_ID=11155111
VERIFIER_ADDRESS=<dedicated-signer-address>
LEADERBOARD_ADDRESS=<deployed-sepolia-leaderboard-address>
```

Example unit, **review only**, requiring a systemd version supporting `LoadCredential` and `%d`:

```ini
[Unit]
Description=Pinball Foundry score verifier (isolated)
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
User=pinball-foundry
Group=pinball-foundry
WorkingDirectory=/srv/pinball-foundry/current/verifier
EnvironmentFile=/etc/pinball-foundry/verifier.env
LoadCredential=verifier-key:/etc/pinball-foundry/verifier-key
Environment=VERIFIER_PRIVATE_KEY_FILE=%d/verifier-key
ExecStart=/usr/bin/node /srv/pinball-foundry/current/verifier/server.mjs
StateDirectory=pinball-foundry
StateDirectoryMode=0700
UMask=0077
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
KillSignal=SIGTERM
KillMode=control-group
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/pinball-foundry
RestrictAddressFamilies=AF_INET AF_UNIX
LimitNOFILE=256
MemoryMax=384M
CPUQuota=50%
TasksMax=32

[Install]
WantedBy=multi-user.target
```

`CPUQuota`/memory are starting proposals, not validated host capacity. Check journal startup/stop events, credential file mode in the service context, hardening compatibility and resource throttling before enabling automatic restarts. No `PrivateNetwork=true`: that would isolate the loopback listener from host Caddy. SIGTERM/SIGINT stop admission, drain active work, bound incomplete uploads and close SQLite; do not use `kill -9` as routine rollout. The app logs only generic lifecycle/error information, not keys, environments, request bodies, wallets or proofs. Caddy access logs and journal retention still need a separate privacy/size policy; do not log bodies or authorization data.

## Caddy and the actual frontend variable

The actual current frontend variable is **`VITE_SCORE_VERIFIER_URL`**, **not `VITE_SCORE_API_URL`**. Inspection of `src/score-chain.ts` found that the current client accepts only a root origin and appends `/v1/...`; it rejects relative paths and `/api` base paths. No frontend file is changed here.

A same-origin configuration compatible with that client is `VITE_SCORE_VERIFIER_URL=https://game.example` plus the separately verified `VITE_LEADERBOARD_ADDRESS`. The `/v1/*` handler below supports it. The requested `/api/*` proxy is also provided as an alias: `/api/v1/tables` becomes backend `/v1/tables`. **Do not claim a frontend configured with `/api` works unless its URL parser/request construction is separately changed and tested.** After that separate client change, an absolute same-origin `https://game.example/api` base can use only the `/api/*` handler.

Example **new site block**; do not replace or edit Rialo's block. Domain/path/port are examples:

```caddyfile
game.example {
    handle_path /api/* {
        reverse_proxy 127.0.0.1:3217
    }
    handle /v1/* {
        reverse_proxy 127.0.0.1:3217
    }
    handle {
        root * /srv/pinball-foundry/current/site
        try_files {path} /index.html
        file_server
    }
}
```

Caddy must preserve the original Host (its normal HTTP reverse-proxy behavior). Do not rewrite Host to `127.0.0.1:3217`, expose the verifier directly, route unknown API paths to the SPA, enable wildcard CORS, or put secrets beneath the static root. A separately approved proxy request-body/connection/abuse policy can further protect Caddy; application limits do not limit public edge bandwidth. A custom trust-proxy/IP-rate policy is intentionally not introduced.

Before an authorized reload, validate the **complete** candidate Caddy configuration with the installed Caddy binary, diff it against the original, confirm the current Rialo site remains byte-for-byte intact, back up the original and arrange immediate rollback. These examples have not been validated against the installed live Caddy/systemd versions.

## Backups, restoration and rollback

- Use a consistent SQLite backup, **not `cp scores.sqlite` while WAL is active**. The Node 24 online backup API is exercised in the local DB tests. An operator-reviewed one-off example (run as the isolated account, with private destination directory and unique destination filename):

```sh
node --input-type=module -e '
import { DatabaseSync, backup } from "node:sqlite";
import { existsSync } from "node:fs";
process.umask(0o077);
const [source, target] = process.argv.slice(1);
if (!source || !target || existsSync(target)) throw Error("use a new backup target");
const db = new DatabaseSync(source, { readOnly: true });
try { await backup(db, target); } finally { db.close(); }
const check = new DatabaseSync(target, { readOnly: true });
try { if (check.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw Error("backup invalid"); }
finally { check.close(); }
' /var/lib/pinball-foundry/scores.sqlite /var/backups/pinball-foundry/<unique-name>.sqlite
```

- Schedule a bounded retention policy only after the operator approves ownership, backup frequency, off-host encrypted storage and disk budget. Monitor backup success, restore drills, free bytes/inodes and SQLite/WAL growth. Keep the signing key's encrypted backup separate; DB backups contain wallet/challenge metadata and need privacy protection too.
- Restore drill: stop **only** the verifier, retain its old DB/WAL/SHM together in a private recovery directory, verify the chosen backup, restore into a fresh isolated state directory with correct ownership/modes and no stale WAL/SHM from a different DB, then start and let schema/integrity validation run. Never restore into or modify a Rialo database.
- **A backup can roll back consumed flags.** Keep verification offline for at least the full 900s challenge lifetime plus clock-skew margin after stopping the old service before reopening a restored snapshot. Check clock synchronization. This expires all previously issued challenges; cleanup removes them at startup. Onchain nonce checks are not a substitute for this offchain restore safety step.
- For code-only rollback: stop the verifier, preserve current state, atomically select the previous immutable frontend/verifier release and restart with the same compatible version-1 DB/config. Prefer rolling back code, not DB. Never run two releases against one file. Unknown newer schema versions deliberately fail startup; a future migration needs its own backed-up upgrade/downgrade plan.
- Keep the previous static release and Caddy configuration available. Recheck both Pinball and Rialo health after any authorized switch/rollback. The current leaderboard has an **immutable verifier and no owner, pause or key-rotation function**. A stolen signer cannot be revoked at that contract address; stopping this HTTP service cannot prevent direct forged submissions. Recovery requires a separately approved fresh contract/key and client-address migration; the old leaderboard remains compromised. No contract or wallet action is authorized by this document.

## Later live acceptance checklist — not yet performed

1. Obtain explicit deployment/DNS/privileged approval and confirm this app's isolated paths/account/port; recheck Rialo's health and preserve its config.
2. Verify intended DNS A/AAAA records. Do not leave AAAA pointing to a host without working IPv6/TLS. Arrange 80/443 and certificate issuance through the existing Caddy instance, not a second competing listener.
3. Verify trusted Node runtime origin/checksum, artifact manifest/hash, signer address, Sepolia contract code and contract verifier. Install only the immutable payload and nonsecret config; provision the key privately.
4. Launch the service privately first. Confirm `ss` shows **only `127.0.0.1:3217`**; a correct-host loopback `GET /v1/tables` works, wrong Host gets 421, wrong Origin gets 403, invalid config never starts. Check private DB/WAL/key modes and restart persistence.
5. Validate/review Caddy candidate and TLS chain/hostname, then perform the separately approved reload. From outside, verify HTTPS static page plus `/v1/tables` and `/api/v1/tables` JSON (no SPA HTML for API errors), exact CORS/no-store headers, 404/405 behavior and no access to state/backups/config. Confirm the backend port is unreachable externally.
6. Exercise a real official replay/challenge/signature in the browser using the intended same-origin client build. Recover its signer and compare score/domain/table/wallet/nonce/expiry. Submit the same challenge concurrently: exactly one 200, the other 409; retry after service restart must still fail. Any real wallet transaction needs its own user approval and onchain readback.
7. Perform **bounded, agreed** body/rate/concurrency tests; inspect CPU/RSS/SQLite/WAL/disk/backups and both apps' latency. No live load test has been performed. Establish operator alerts for persistent 429/503, restart loops, expired TLS, failed backups and resource pressure.
8. Verify a private restore drill and code rollback; record exact release hashes and checks. Only then call the service deployed and verified.
