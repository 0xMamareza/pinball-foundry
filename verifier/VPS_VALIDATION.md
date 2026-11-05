# VPS services — historical local validation evidence

This is a historical, pre-deployment test record. Its "not deployed", file-scope and original bundle-hash claims describe that earlier checkpoint only. The live v2 release is described in the root README and `V2_API.md`; the current source's Node 24.20.0 bundle builds to SHA-256 `2e986005ee8d8cf35718b47871d9680ce5fe42c4c28548104ffc7259079d9e35` (172273 bytes), with 128 verifier tests passing in a fresh local run. That local rerun is not a load test or an external audit.

## Selected ranked v2 candidate — current local evidence

This section supersedes the legacy v1 release assumptions below. No public deployment, external write, live wallet action, transaction broadcast, VPS/DNS/Rialo modification, commit or push was performed. Frontend/root files and package manifests were not edited by this backend worker. Foundry tests execute only a local in-process EVM; RPC tests are explicitly simulated loopback fixtures, not fabricated evidence of a real chain transaction. Anvil transaction integration was **not run**, respecting the no-chain-transaction instruction.

### Delivered artifact and scope

- `contracts/src/PinballFoundryRankedStart.sol`, `contracts/test/PinballFoundryRankedStart.t.sol`: nonpayable immutable two-table allowlist, `startRun(bytes32)` / indexed `RunStarted(wallet,tableId)` event. No score storage, owner, signer, fee, relayer or postgame submit.
- New `verifier/src/vps/v2/{chain,database,service,server,main}.ts`: Ethereum Sepolia read-RPC validation; exact receipt/caller/calldata/log/canonical block/confirmations checks; pre-play wallet authorization; replay-verified automatic OFFCHAIN scores; atomic durable nonce/run consumption; idempotent exact retries/conflicting proof refusal; best-per-wallet/table top20; restart persistence.
- `verifier/src/vps/server.ts`: only extracted the existing hardened transport into a reusable `startHttpService`; original v1 handler/config/storage behavior retained and its tests still pass. V2 aborts pending RPCs on shutdown.
- `verifier/scripts/build-vps.mjs`: optional `--v2` entry/output while preserving default v1. `verifier/package.json`: explicit `build:vps:v2`, `bundle:vps:v2`, `start:vps:v2`; no dependency changes made by this worker.
- Four new test files: `vps-v2.test.ts` (7), `vps-v2-chain.test.ts` (20), `vps-v2-http.test.ts` (4), `vps-v2-bundle.test.ts` (1). Existing64 plus new32 = **96 tests**.
- Integration authority: [V2_API.md](V2_API.md). The parent frontend must use `/v2` and reproduce its exact authorization message. **One pre-play transaction plus one free offchain pre-play message signature** authenticates ownership of the public tx hash; no postgame wallet approval. Do not describe this as a single wallet prompt or scores as onchain.

Portable selected release is **`verifier/dist/vps-v2/`**, containing standalone `server.mjs`, linked esbuild legal text, full `THIRD_PARTY_NOTICES.txt` and hash manifest. Current server: **171587 bytes**, SHA-256 **`4b71b39a3c75d8e34898d0b151030e81482c559212bee536db68b029cc5e1814`**. Full notices for10 bundled MIT packages: SHA-256 **`b29deac442c3c0bfb47a78f82f38e0b60fea52363baf42b6d7eaf7d0164d5428`**. Windows and isolated clean-install Linux produced byte-identical v2 artifacts. No `privateKeyToAccount` signer implementation is present in the v2 bundle.

The preserved legacy artifact now changes only because of the shared transport extraction: `dist/vps/server.mjs` **192280 bytes**, SHA-256 **`0800d0bbaaba9e40fb9b1bf7f635b0c11f9e94f1809d1dccd867363463e16e5a`** (both platforms). The older legacy hash in the historical section is not the current build.

### Observed RED → GREEN evidence

- First v2 replay/persistence slice: RED `automatic offchain ranked service is missing: expected null not to be null`, then GREEN authenticated start → deterministic replay → OFFCHAIN receipt → durable leaderboard → identical retry/reopen.
- Contract: RED Foundry `vm.getCode: no matching artifact found` for the absent ranked contract; GREEN **3/3** after implementation. This is a missing-feature artifact failure, not a claim of a behavioral contract assertion failure.
- Chain verification slice: RED `ranked chain verifier is missing`, GREEN20 cases validating successful simulated RPC evidence and rejecting wrong chain, missing/failed receipt, wrong sender/destination/table/value/calldata/event/log address/wallet/table/hash, removed/duplicate logs, insufficient confirmations, reorg, stale/future blocks.
- V2 transport/config slice: RED `ranked HTTP entrypoint missing`; GREEN no-signer startup, Host/Origin/body/rate protections, unsafe config rejection. Existing hardened transport's14 HTTP regressions continue passing.
- Deployment identity regression: RED `expected [Function] to throw an error` when reopening service with another contract; GREEN stored chain/contract/ruleset/table identity refuses mismatch.
- Portable v2 slice: RED `portable ranked v2 bundle missing: expected false to be true`; GREEN two byte-identical builds and independent real HTTP subprocesses from only copied JavaScript without `node_modules`. Explicit simulated read-RPC → authorized start → replay submission → leaderboard → process restart → identical retry is exercised. No real transaction is claimed.
- Stalled-RPC shutdown regression: RED `stalled RPC outlives bounded shutdown: expected false to be true`; GREEN shutdown aborts the pending fetch, returns503, closes within the500ms test bound and closes SQLite.
- Additional already-implemented regression coverage: forged authorization/score/proof/wrong nonce; failed RPC/reorg do not consume; parallel identical start/score calls are idempotent; competing valid proof gets409; consumed start cannot register again; expired tombstones survive cleanup; capacity fails closed; top20/best/table isolation; exact retry after restart. These were added as regression coverage, not claimed as separate RED behavior cycles.

### Executed final gates

Windows (`verifier/`, pinned Node **24.20.0**, NOT ambient unsupported Node26):

```sh
npx --yes --package=node@24.20.0 node node_modules/vitest/vitest.mjs run --config vitest.config.ts
npx --yes --package=node@24.20.0 node node_modules/typescript/bin/tsc --noEmit
npx --yes --package=node@24.20.0 node scripts/build-vps.mjs --v2
WRANGLER_SEND_METRICS=false npx --yes --package=node@24.20.0 node C:/Users/mruni/AppData/Local/hermes/tools/node-26.7.0-win32-x64/node_modules/npm/bin/npm-cli.js run bundle
```

Observed: **10 test files passed, 96/96 tests**, strict tsc exit0; v2 hash/size above. Legacy Cloudflare dry bundle also passes96/96 + tsc, Wrangler4.157.0 reports **189.77 KiB / gzip45.97 KiB**, `--dry-run: exiting now`. This is not deployment. `forge test --root contracts --summary` at repository root: **33/33** (registry15, legacy leaderboard15, ranked start3), all suites0 failed/0 skipped. No external chain transaction is needed for Foundry tests.

Clean-install local WSL Linux (NOT VPS): `/home/sirius/.cache/hermes-scratch/pinball-v2-repro-20261104`. Exported HEAD with `git -c core.autocrlf=false archive` then overlaid current nonignored verifier/contract source/tests using a deduplicated Git file enumeration. No ignored `.env`, dependencies, keys or build artifacts exported. Node24.20.0 and npm11.19.0 installed tool caches were reused; a clean `npm ci --include=dev --ignore-scripts` installed83 packages/audited84, zero reported vulnerabilities (not a code security audit). Actual `npm run bundle:vps:v2` passed **96/96**, strict tsc and v2 build; `npm run build:vps` rebuilt the preserved legacy candidate. Both server hashes match Windows. Linux also ran all **33/33 Foundry tests**. Both portable-bundle tests assert deterministic bytes, restart persistence and, on Linux, clean SIGTERM exit0 / stopped lifecycle event.

Reproduction harness issue resolved, not waived: nested Windows `wsl bash -lc` quoting expanded variables/PATH incorrectly and produced literal-quote/space syntax errors before running tests. Running a real LF shell script with `wsl.exe bash /mnt/c/.../pinball-v2-repro.sh` and an explicit Linux-only Node/npm/tool PATH resolved it. No ruleset/source pin was changed.

### Remaining boundaries

No public start contract/address, public HTTPS endpoint, frontend v2 hookup/browser proof, production free-RPC availability, shared-host load/capacity test, external security audit, continuous deep-reorg reconciliation or live backup/restore is certified. Only EOAs/65-byte personal signatures are supported. Deterministic replay verifies score consistency, not human play or bot resistance. Tombstones consume bounded storage permanently and need capacity monitoring. Receipt confirmation policy defaults3, not a finality guarantee. A snapshot restoration may lose scores/consumption; follow the v2 reconciliation/admission-offline warning in deployment/API docs. Parent must review the free pre-play message-signature prompt in its integration UX. All edits remain uncommitted.

## LEGACY v1 evidence — historical checkpoint, not selected product path

The rest of this file records the prior signer-based `/v1` candidate. Its old file-scope/hash statements describe that earlier checkpoint only; they do not describe the current ranked v2 release.

## Scope and artifact

- Baseline: `main`, `85ad47a810e05be8ee885bcade6154e59e4bd46a`.
- Only repository paths beneath `verifier/` were changed. Original Worker/replay/typed-data source, migration, original tests, frontend and contracts were not modified. No commit, push, SSH, deployment, live DB, Caddy, systemd or DNS change was performed.
- Runtime exercised: **Node 24.20.0**, bundled **SQLite 3.53.4**, npm **11.19.0**; Windows x64 and local Linux x64 under WSL. Production CLI rejects unsupported runtime majors.
- Final portable artifact after independent review fixes: `verifier/dist/vps/server.mjs`, **192137 bytes**, plus `THIRD_PARTY_NOTICES.txt` (complete licenses for all 10 bundled npm packages).
- SHA-256 (server): **`bed28d49a52f4d6544cd4211e18adfdbdf3066c763abc658f992f0cbc323c6bf`**; notices SHA-256: **`b29deac442c3c0bfb47a78f82f38e0b60fea52363baf42b6d7eaf7d0164d5428`**.
- The same exact bytes were produced on Windows and in an isolated Linux clean-install source export. Each portable-bundle test also builds twice and asserts byte equality, copies only the JavaScript to a private directory with no `node_modules`, launches real HTTP subprocesses, issues a durable challenge, restarts, reads persistence, verifies invalid-host startup exits 1 and checks logs exclude the disposable test key. Linux additionally asserts graceful SIGTERM exit 0 and the stopped lifecycle event.

## Observed test-first RED → GREEN cycles

The targeted test was run and observed failing before the corresponding final behavior was implemented; each slice was rerun GREEN before the next slice. These are observed assertion failures, not fabricated test results. Additional tests of already-working shared Worker behavior, backup API and independent table/nonces were added as regression coverage without claiming they were new RED failures.

| Slice | Observed RED | Observed GREEN |
| --- | --- | --- |
| Durable database | `durable VPS database adapter is not implemented: expected null not to be null` | File WAL migration and reopen preserve challenge. |
| SQL storage capacity/reclamation | Overflow insertion `expected [Function] to throw an error` | Trigger denies overflow; expired-only deletion frees one slot. |
| Schema validation | Drifted DB `expected [Function] to throw an error` | Future, unversioned-nonempty, drifted and corrupt DBs refused. |
| HTTP integration | `loopback Node HTTP adapter is not implemented: expected null not to be null` | HTTP challenge → restart → valid replay/signature; same nonce yields `[200,409]`; consumed state survives another restart. |
| Configuration | `validated startup configuration is not implemented: expected null not to be null` | Bad bind/domain/chain/key/address/path/limit configurations refused. |
| Host authority | Wrong Host: `expected 200 to be 421` | Host/Origin policy enforced; forwarding headers cannot replace authority. |
| Early body bounds | Declared and chunked unfinished uploads: `oversized unfinished body was not rejected promptly` | Both receive 413 before sender terminates upload. |
| Global rate budget | `expected 200 to be 429` | Rotating spoofed client IPs cannot bypass budget; refill permits later request. |
| In-flight/body deadline | `expected 200 to be 503` | Slow upload occupies a slot; next request gets 503; slow request gets 408 and releases capacity. |
| Expired cleanup | Expired row `expected { nonce: 'expired' } to be undefined` | Scheduled and startup cleanup remove expiry, preserve live consumed nonce. |
| Bounded shutdown | Deadline race `expected false to be true` | Idempotent close force-terminates unfinished upload, closes DB and allows restart. |
| TCP/parser bounds | Extra idle connection `expected false to be true`; 9 KiB header `expected 200 to be 431` | Connection cap applies before headers; parser rejects >8 KiB. |
| Portable production bundle | Expected build subprocess status 0, got 1: missing `scripts/build-vps.mjs` | Deterministic standalone bundle executes and persists across process restart. |
| Duplicate Host | `HTTP/1.1 200 OK` did not contain `400` | Raw duplicate Host rejected. |
| Explicit runtime guard | `runtime validation is not implemented: expected undefined to be type of 'function'` | Final guard accepts Node 24.20+ within major 24 and rejects other/malformed versions. |
| Mandatory WAL | Non-WAL memory database: `expected [Function] to throw an error` | Adapter refuses storage that does not enter persistent WAL mode. |

The schema RED initially also exposed a disposable-test cleanup error from a handle returned unexpectedly; failure cleanup/resource handling was corrected. Tests were moved from the platform default temp directory to the Hermes scratch directory on Windows. Initial strict typecheck found a missing SQL-import declaration and a DOM `BodyInit`/Node Buffer type mismatch; the declaration and explicit Uint8Array conversion fixed both. None of those failures is counted as a passing gate.

## Final gates actually executed

### Windows repository

Working directory: `C:/Users/mruni/Projects/pinball-foundry/verifier`.

```sh
npx --yes --package=node@24.20.0 node node_modules/vitest/vitest.mjs run --config vitest.config.ts
npx --yes --package=node@24.20.0 node node_modules/typescript/bin/tsc --noEmit
npx --yes --package=node@24.20.0 node scripts/build-vps.mjs
```

Results after review corrections: **64/64 tests across 6 files**, strict typecheck exit 0, bundle hash/size as above. Breakdown: existing replay **26**, existing Worker **13**, VPS DB **9**, VPS HTTP **14**, portable bundle **1**, runtime guard **1**.

The declared original Cloudflare and local-chain paths were also rerun after the final production changes. On this Windows machine the ambient Node is 26.7.0, so npm was invoked with the pinned Node explicitly:

```sh
npx --yes --package=node@24.20.0 node C:/Users/mruni/AppData/Local/hermes/tools/node-26.7.0-win32-x64/node_modules/npm/bin/npm-cli.js run bundle
npx --yes --package=node@24.20.0 node C:/Users/mruni/AppData/Local/hermes/tools/node-26.7.0-win32-x64/node_modules/npm/bin/npm-cli.js run test:local
npx --yes --package=node@24.20.0 node scripts/build-vps.mjs
```

Results after review corrections: **64/64** and typecheck passed; Wrangler **4.157.0** dry run exited 0, **189.77 KiB / gzip 45.97 KiB**, explicitly `--dry-run: exiting now`; existing workerd+D1+loopback Anvil integration **1/1 passed** using the already-existing local Solidity artifacts. The final standalone VPS artifact was rebuilt afterwards. This integration path is the original Cloudflare implementation, not a live VPS or wallet transaction.

A manual launch under the ambient unsupported Node 26.7.0 returned only `verifier startup failed`, exit **1**. No listener or configured secret was needed for that check.

### Clean-install Linux reproduction (local WSL, NOT the VPS)

Workspace retained for inspection: `/home/sirius/.cache/hermes-scratch/pinball-vps-repro.J5syZm`.

The complete baseline repository was exported with:

```sh
git -c core.autocrlf=false archive --format=tar --output=<scratch>/pinball-vps-repro-base.tar HEAD
```

All current nonignored `verifier/` source/config/test files were overlaid from the working tree (enumerated with `git ls-files -co --exclude-standard -- verifier`); no ignored environment, keys, dependencies or build output were exported. This is baseline HEAD plus the current uncommitted verifier candidate, **not a claim that HEAD contains the adapter**. Production source did not change after these final runs.

Linux Node 24.20.0 was extracted into `/home/sirius/.cache/hermes-scratch/pinball-vps-node24/package`, and Linux npm 11.19.0 into `/home/sirius/.cache/hermes-scratch/pinball-vps-npm11/package`, with a normal executable symlink `bin/npm -> ../package/bin/npm-cli.js`. The final commands in the exported `verifier/` directory were:

```sh
export PATH="$HOME/.cache/hermes-scratch/pinball-vps-node24/package/bin:$HOME/.cache/hermes-scratch/pinball-vps-npm11/bin:$PATH"
export TMPDIR="$HOME/.cache/hermes-scratch/pinball-vps-repro.J5syZm/tmp"
export npm_config_script_shell=/bin/sh
node --version                  # v24.20.0
npm --version                   # 11.19.0
npm ci --include=dev --ignore-scripts
npm run bundle:vps
sha256sum dist/vps/server.mjs
```

Final clean install added **83 packages / 84 audited**, with zero reported dependency vulnerabilities (not a security audit); the original candidate passed 63/63. After independent review fixes, the same isolated Linux workspace received only the changed source/test/build files; `npm run bundle:vps` then passed **64/64 tests**, strict tsc, and rebuilt standalone server **192137 bytes** with the identical SHA-256 and third-party notice SHA-256 reported above. POSIX signal teardown, file-backed WAL, online backup/reopen, preflight refusal of foreign rollback-journal databases and real HTTP limits were exercised on Linux, not just simulated with mocks.

Two initial reproduction-harness problems were diagnosed rather than waived:

1. Git for Windows archive creation with ambient CRLF conversion changed exported engine/layout bytes although the working tree/Git blobs were LF; the existing source-pin test correctly failed. Re-export with `core.autocrlf=false` restored the exact pinned engine SHA `3a1306b0d9c803b603d075547c63fa772bf3585da0dd6c4cd8b0280bf19ef495` and layout SHA `884ae0c12f64a261447bd786499a494c611495cd031cc8ce189544c1c0d60c52`. Neither source nor pin was changed.
2. WSL inherited a Windows npm shim for nested `npm test`, causing cmd.exe/UNC execution failure. Real Linux npm on PATH plus `/bin/sh` fixed the harness. The final declared `npm run bundle:vps`, not just an approximation of it, passed after clean install.

## Independent review corrections

Read-only independent review found no high/medium remote exploit, but two low deployment issues. Each was reproduced with a new regression before changing production code:
- Existing foreign SQLite file: startup previously converted its `journal_mode=DELETE` to WAL before rejecting its schema. The new test failed with actual `wal` instead of `delete`. An existing file is now validated read-only (version, exact schema and integrity) before any persistent PRAGMA; the test passes and its sentinel row survives unchanged. A fresh missing database still initializes via the embedded migration.
- Bundled dependency notices: the original portable build had only abbreviated esbuild license comments. The new bundle test failed because `THIRD_PARTY_NOTICES.txt` was absent. Build now derives all bundled npm packages from esbuild's metafile, requires reviewed MIT LICENSE content, writes complete notices for 10 packages, records a notice SHA in the manifest, and the test checks Viem/Noble notices and integrity.

The parent reran Node24 Windows `bundle:vps` (64/64, strict typecheck, production bundle), `bundle` (64/64, typecheck, Wrangler dry-run), workerd+D1+Anvil `test:local` (1/1), `git diff --check`, and the updated Linux Node24 `bundle:vps` (64/64, same server and notice hashes). These checks follow the final source edits; the initial independent review did **not** sign off on the subsequently edited files. No live server action, contract deployment or user wallet approval was performed.

## Boundaries and remaining risks

- No deployment, public endpoint/TLS/DNS, installed live systemd/Caddy example, production key, live chain transaction or shared-host capacity/load test is certified. [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md) is an operational review/runbook, not an execution record.
- The actual frontend variable is `VITE_SCORE_VERIFIER_URL`. The current client accepts a root origin, not an `/api` base; the runbook includes a compatible same-origin `/v1/*` route and the required `/api/*` alias. A prefix-only client change is outside this adapter's scope.
- One process/writer per DB. Global rate limiting protects bounded resources but is not fair per-client admission or DDoS prevention. Signer compromise, root access, full disk, slow external backup/readers holding WAL, and recovery from an older consumed-nonce snapshot remain operator concerns.
- The unchanged leaderboard contract's verifier is immutable; there is no owner/pause/rotation function. Key compromise requires a separately authorized fresh contract and client migration, and cannot be repaired by restarting this adapter.
- No independent external security audit or live release sign-off was performed. Changes remain uncommitted for parent review. Temporary service subprocesses were stopped by the tests; retained reproduction directories contain source/tool caches and test-built artifacts, not a running service or production key.
