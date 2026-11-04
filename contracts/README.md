# Pinball Foundry registry

Standalone, dependency-free Solidity registry for explicit table publication. Intended deployment network: **Ethereum Sepolia**. The contract is chain-agnostic; nothing has been deployed to a public network by this work. Local game/editor actions do not publish anything; a user must explicitly send `publish` from their wallet and pay the network's transaction gas. This contract never charges or accepts a publication payment.

## Interface and frontend contract

```solidity
function publish(string calldata title, bytes calldata layout) external returns (uint256 id);
function getTable(uint256 id) external view
    returns (address creator, string memory title, bytes memory layout, uint64 publishedAt);
function tableCount() external view returns (uint256);
event TablePublished(uint256 indexed id, address indexed creator, string title, bytes layout);
```

- IDs start at **1**. `tableCount()` starts at **0**, is the number published, and is also the highest valid ID. Valid reads are exactly `1..tableCount()`; all other IDs revert with `TableNotFound()`.
- `creator` is `msg.sender`; `publishedAt` is the publication block timestamp, in Unix seconds. Entries cannot be edited or deleted.
- The Solidity return value from `publish` is available in simulation, **not** as a transaction-receipt return value. After receipt confirmation, obtain the actual ID from `TablePublished`, checking the emitting contract address and creator. Concurrent publishers can invalidate a previously simulated next ID.
- Full compiler-generated ABI: [`PinballFoundryRegistry.abi.json`](PinballFoundryRegistry.abi.json). It includes `InvalidTitle()`, `InvalidLayout()`, and `TableNotFound()` custom errors.
- Verified selectors: `publish(string,bytes)` = `0x44e8fd08`; `getTable(uint256)` = `0x195e251f`; `tableCount()` = `0x4155fc5b`. The event has two indexed fields, ID then creator; title/layout are unindexed data.

### Validation

Titles contain **1–40 bytes**, each printable ASCII (`0x20..0x7e`), with at least one non-space character. Leading/trailing spaces are preserved. UTF-8 non-ASCII, tabs, control bytes, empty and space-only titles are rejected.

Layout is a compact byte string, **not ABI-encoded triples or JSON**:

```
[count, kind0, x0, y0, kind1, x1, y1, ...]
```

- Count: **3–12**, with byte length exactly `1 + 3 * count` (no extra/truncated bytes).
- Kind: `0` bumper, `1` spinner, `2` target.
- X: **28–227**, Y: **24–190**, inclusive, in the encoded 0–255 coordinate system.
- Every distinct pair: squared center distance **>= 256** (distance >= 16). Coincident, axis-near and diagonal-near pairs are rejected. Computation widens coordinates before subtraction/multiplication.
- Valid three-element example: `0x03002828015050027878` = bumper (40,40), spinner (80,80), target (120,120).

Identical layouts/titles may be republished by the same or different creators. No fingerprint dedupe was added: a permissionless catalog should not suggest exclusive authorship, and each publication already costs transaction gas. Creator identity records the caller, not originality or ownership.

## Build and test

Prerequisites: Foundry (`forge`, `cast`, `anvil`) on PATH. Python **3.10+** is needed only for the optional smoke runner; no Python packages or Solidity libraries are required. The first build may download the pinned compiler.

From this directory:

```bash
forge build
forge fmt --check
forge test -vv
forge lint --deny warnings
forge coverage --report summary
python -m unittest discover -s test -p 'test_smoke.py' -v
python script/smoke.py
```

Compiler: **Solidity 0.8.30** (exact pragma and `foundry.toml` compiler pin), EVM target **Prague**, optimizer enabled with **200** runs. Fuzz tests use **512** runs each and a configured seed. The tested Foundry version is recorded in [`evidence/verification.json`](evidence/verification.json).

Foundry 1.7 treats `table`-prefixed functions as table-driven tests and otherwise mistakes the production `tableCount()` getter for a test. `match_path = "test/*.t.sol"` deliberately restricts discovery to test files. Keep that filter when running the suite.

### Local-only Anvil smoke

`python script/smoke.py` builds the contract, launches its **own** Anvil on a dynamically allocated loopback port and chain **31337**, deploys, and publishes from two different locally funded accounts. It verifies:

- deployed runtime exactly matches the compiled artifact, and the saved ABI matches the artifact;
- initial count zero, returned IDs 1/2, counts after each receipt;
- full persistent readback, creator, title, layout, block timestamp and unchanged first creator;
- real receipt event address, indexed topics and dynamic payload;
- unknown IDs 0 and 3 reject with the correct custom error;
- its disposable Anvil process stops before returning.

Anvil generates **random, local-only** accounts. Mnemonics/private keys are never read or saved; startup output is discarded. Transactions use only that process's unlocked local RPC accounts. The script takes no RPC URL, wallet key, deployment-network or fork options, does not consult wallet credentials, and cannot publish to Sepolia. Run Python normally (not with `-O`, which disables assertions).

JSON output contains public transaction hashes, contract address, table records, publication gas use and verification flags. A real captured run is [`evidence/anvil-smoke.json`](evidence/anvil-smoke.json); its addresses/hashes are ephemeral **local Anvil data**, not Sepolia addresses or explorer links. Repeated runs generate different accounts and hashes.

## Verification evidence

- `evidence/01-*` through `07-*`: seven incremental Solidity RED/GREEN slices, starting with deliberate unimplemented stubs, then persistence, titles, layout framing, element bounds, pairwise separation, event and ID-range behavior. The first unfiltered full run records the Foundry getter-discovery issue; the filtered rerun passes.
- `evidence/08-expanded-suite.txt`: additional security, boundary, multiple-creator and fuzz regression tests.
- `evidence/09-smoke-runner-{red,green}.txt`: real Python integration RED/GREEN.
- `evidence/final-forge-test.txt`: final **15 passed, 0 failed**, including three 512-run fuzz tests.
- `evidence/coverage.txt`: registry **100% line, statement, branch and function coverage** under Foundry's unoptimized coverage instrumentation. This is coverage evidence, not an audit or a proof of correctness.
- `evidence/final-forge-lint.txt`, `evidence/verification.json` and `evidence/anvil-smoke.json`: final lint, build/ABI metadata and optimized-runtime RPC verification. Smoke rebuilds after coverage so the runtime check uses production optimizer settings.

## Security boundaries / deliberately absent features

Publication is public, permanent and permissionless. Do not put secrets or personal information in titles/layouts. There is no moderation, authenticity guarantee, originality check, rate limit or anti-spam policy beyond the bounded inputs and network gas cost; display titles as text, not HTML.

There are **no tokens, stakes, NFTs, ownership transfers, administrators, upgrades, rewards, payouts, score submissions, signature claims, arbitrary external calls, payable functions, fallback or receive handler**. Ordinary calls carrying Ether revert; forced Ether transfers are outside this publication API. `creator` is attribution of the publishing account only. Local gameplay scores are not onchain results or verified claims.

No public deployment, user key use, Git push or independent security audit was performed. Public deployment and frontend address/network configuration remain separate integration tasks.
