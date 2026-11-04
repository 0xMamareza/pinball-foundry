# Pinball Foundry

An independent, playable browser pinball workshop inspired by Squeekchain's settlement data. Play two house tables, build and test your own, save locally or share a layout link. Publishing a table is a separate, optional **Ethereum Sepolia testnet** transaction; gameplay never asks for a wallet.

## Play locally

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. The midnight workshop **dark theme is the default**; the header's Light/Dark button switches to the original paper palette and remembers the choice in this browser. On wide screens, a quiet circuit-wheel drawing and engraved cabinet plaque show the actual selected table and part count; they are decorative, not a leaderboard or settlement indicator, and are omitted on narrow screens. Hold and release **Space** to launch; **A/D** or **←/→** operate the flippers. Touch controls are below the machine. Pause with **P**. The workshop supports 3–12 parts, dragging, keyboard-accessible nudge controls, local saves and share links. A saved workshop draft is restored on reload in the same browser; **Load local save** also restores it after unsaved edits. Sound defaults on and unlocks at the first gameplay gesture; use **♪ ON/OFF** in the header to mute. Locally generated cues distinguish launch, flippers, bumper/spinner/target hits, charged hits, drains and game over. No autoplay or external audio files are required.

## Settlement and wallet boundaries

The app reads the public Squeekchain settlement API. It only uses entries marked safe/confirmed whose Ethereum block is within the API's safe-through block. `workAdded mod 3` selects one of the table's bumpers **when a new run starts**, giving that bumper +125 base points and a stronger rebound. The run never changes mid-ball. If no safe data is available, it explicitly uses an offline finish with no charged bumper. The API is a read-only, trusted external source for this game variation; the app does **not** prove its contents onchain. The transaction link lets you inspect the reported settlement.

Free play, editor, local saves and share links do not require a wallet. Onchain table publication requires a separately deployed registry address, user wallet approval, and Sepolia test ETH for gas. Publication is public and permanent. Titles must be printable ASCII, 1–40 characters; local-only titles may be longer or contain Unicode. Do not put private information in a title or share link. **There is currently no public Sepolia deployment configured.** The local Anvil smoke test in `contracts/` is not a public transaction.

## Optional score leaderboard (not deployed)

Each run displays its score locally; no wallet interaction interrupts gameplay. An **official standard, uncharged house-table** run records fixed-step inputs and launch powers for a deterministic replay. Custom or settlement-charged runs remain local-only. After the third ball, a player may choose to connect a Sepolia wallet and send the replay to a separately hosted verifier. That verifier reconstructs the score and signs a short-lived, wallet-bound attestation. A second, explicit wallet action can submit the final score to the original `PinballFoundryLeaderboard` contract, paying Sepolia test ETH gas. The public top 20 is read from the contract; each wallet's best score is retained. The verifier is trusted and cannot prove a human rather than a bot played. There are no tokens, prizes or automatic submissions.

The implementation lives in `src/score-*`, `verifier/` (Cloudflare Worker + D1; **no VPS is required**) and `contracts/src/PinballFoundryLeaderboard.sol`. Both verifier and leaderboard address are deliberately unconfigured, so the UI does **not** claim online rankings. Before any public launch, review `verifier/DEPLOYMENT.md`, provision a real verifier origin/database/secrets and deploy/verify the matching Sepolia contract with separate authorization. Local workerd/D1/Anvil integration is **not** a public deployment or a live wallet transaction.

To enable a *separately authorized* public deployment, deploy and verify `contracts/src/PinballFoundryRegistry.sol` on Ethereum Sepolia, then set `VITE_REGISTRY_ADDRESS` to its verified address in your local `.env` before building. See `.env.example` and `contracts/README.md`. The app intentionally disables publishing and registry browsing until that address is configured. Never put a private key in a frontend environment variable.

## Test and build

```bash
npm test
npm run build
forge build --root contracts --force
forge test --root contracts --summary
npm --prefix verifier test
npm --prefix verifier run typecheck
WRANGLER_SEND_METRICS=false npm --prefix verifier run bundle
npm --prefix verifier run test:local
```

The browser proof script requires the Playwright Chromium browser and a running production preview on `http://127.0.0.1:5199/`:

```bash
npm run preview -- --host 127.0.0.1 --port 5199
node scripts/visual-proof.mjs
```

The browser script exercises keyboard and touch gameplay, pause, editor save/reload/playtest, the undeployed-registry guard and responsive layouts; it saves screenshots and diagnostics under the Hermes scratch directory by default. Set `PINBALL_EVIDENCE` to choose another evidence directory.

Original artwork is drawn in Canvas/SVG and CSS. Independent project, not an official Squeekchain product. No NFT, SQK token or paid provider is needed.
