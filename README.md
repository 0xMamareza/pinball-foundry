# Squeek Pinball

An independent browser pinball arcade for the Squeekchain community. **Play live:** https://squeekpinball.xyz/. Play two house tables, build and test your own, save locally or share a layout link. Practice is wallet-free; official ranked starts require Sepolia wallet actions. This is an original project, **not an official Squeekchain product**. The repository and some internal identifiers retain the earlier working title, Pinball Foundry.

## Play locally (Node.js 24.20.0)

```bash
npm ci
npm --prefix verifier ci
npm run dev
```

Open the local URL printed by Vite. The midnight workshop **dark theme is the default**; the header's Light/Dark button switches to the original paper palette and remembers the choice in this browser. On wide screens, a quiet circuit-wheel drawing and engraved cabinet plaque show the actual selected table and part count; they are decorative, not a leaderboard or settlement indicator, and are omitted on narrow screens. Hold and release **Space** to launch; **A/D** or **←/→** operate the flippers. Touch controls are below the machine. Pause with **P**. The workshop supports 3–12 parts, dragging, keyboard-accessible nudge controls, local saves and share links. A saved workshop draft is restored on reload in the same browser; **Load local save** also restores it after unsaved edits. Sound defaults on and unlocks at the first gameplay gesture; use **♪ ON/OFF** in the header to mute. Locally generated cues distinguish launch, flippers, bumper/spinner/target hits, charged hits, drains and game over. No autoplay or external audio files are required.

## Settlement and wallet boundaries

The app reads the public Squeekchain settlement API. It only uses entries marked safe/confirmed whose Ethereum block is within the API's safe-through block. `workAdded mod 3` selects one of the table's bumpers **when a new run starts**, giving that bumper +125 base points and a stronger rebound. The run never changes mid-ball. If no safe data is available, it explicitly uses an offline finish with no charged bumper. The API is a read-only, trusted external source for this game variation; the app does **not** prove its contents onchain. The transaction link lets you inspect the reported settlement.

Practice, editor, local saves and share links do not require a wallet. Onchain *table publication* requires a separate registry contract and wallet approval; this optional registry is **not configured** on the public site. Titles for eventual publication must be printable ASCII, 1–40 characters; local-only titles may be longer or contain Unicode. Do not put private information in a title or share link.

## Ranked scores (live, offchain)

An **official standard, uncharged house-table** run records fixed-step inputs and launch powers for deterministic replay; custom or settlement-charged runs are practice-only. To start ranked play, connect a burner wallet on **Ethereum Sepolia**, send **one pre-play testnet transaction** to `PinballFoundryRankedStart` at `0x621A6b79Eb6eac51bDE51e6AfACA60716C6B3554`, then approve **one separate no-gas ownership signature**. The game starts only after admission. At the end of a complete run, the Node.js service replays the inputs and automatically stores a successful result in VPS SQLite. The public leaderboard shows replay-verified **offchain** scores; the score itself is **never onchain** and there is no postgame wallet transaction. The verifier trusts its RPC and cannot prove a human played. The contract is unaudited; use a disposable wallet and Sepolia test ETH only. There are no tokens or prizes.

The current path lives in `src/ranked-client.ts`, `verifier/src/vps/v2/`, and `contracts/src/PinballFoundryRankedStart.sol`; see `verifier/V2_API.md` and `verifier/VPS_DEPLOYMENT.md` for protocol and operator boundaries. Production requires an HTTPS origin, operator-controlled Sepolia RPC, Node 24, private SQLite database, rate limits and backups. The frontend needs matching build-time `VITE_RANKED_API_URL` and `VITE_RANKED_START_ADDRESS`; never put secrets in a `VITE_` variable. This repository contains no live database, server TLS keys or RPC credentials. The old Worker/D1 verifier, `src/score-chain.ts`, and `PinballFoundryLeaderboard.sol` remain as legacy alternatives and are **not** the live ranked-score system.

To enable separately authorized table publishing, deploy and verify `contracts/src/PinballFoundryRegistry.sol` on Sepolia and set `VITE_REGISTRY_ADDRESS` at build time. See `.env.example` and `contracts/README.md`. Publishing and registry browsing remain disabled on the public site. Never put a private key in a frontend environment variable.

## Test and build

```bash
npm test
npm run build
forge build --root contracts --force
forge test --root contracts --summary
npm --prefix verifier test
npm --prefix verifier run typecheck
npm --prefix verifier run build:vps:v2
```

The browser proof script requires the Playwright Chromium browser and a running production preview on `http://127.0.0.1:5199/`:

```bash
npm run preview -- --host 127.0.0.1 --port 5199
node scripts/visual-proof.mjs
```

The browser script exercises keyboard and touch gameplay, pause, editor save/reload/playtest, the undeployed-registry guard and responsive layouts; it saves screenshots and diagnostics under the Hermes scratch directory by default. Set `PINBALL_EVIDENCE` to choose another evidence directory.

Original artwork is drawn in Canvas/SVG and CSS. No NFT or SQK token is needed. Automated and simulated-RPC tests are not a substitute for live-wallet verification or production load testing.
