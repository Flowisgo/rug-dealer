# Repeatable full loan demo

The branch contains the Soroban contract, five role pages, and testnet preparation tooling. It is based on `codex/first-loan-flow` and incorporates the existing buyer frontend. Do not merge it without team review.

## Local checks and website

Prerequisites: current stable Rust with `wasm32v1-none`, Stellar CLI 30.0.1 or compatible newer, Python 3.10+, curl, and Node.js 24 LTS with npm.

```sh
cargo test --workspace --locked
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
stellar contract build --locked
cd frontend
npm ci
npm run typecheck
npm run build
npm start
```

The app is available at http://127.0.0.1:3000. Use Chrome with Varial / Freighter for signing. The in-app browser can inspect receipts but cannot host that wallet extension. The production app has no server signing keys or wallet mocks.

## Deployment and preparation

Set a local directory **outside the checkout** for demo identities and transaction logs. Keep the same directory when preparing additional receipts for a deployment. `STELLAR_CLI` optionally supplies an absolute CLI path.

```sh
export RUG_DEMO_HOME="$HOME/.local/share/rug-dealer-demo"
python3 scripts/demo.py deploy
```

`deploy` creates or reuses five separate demo identities, funds test XLM, creates Circle testnet USDC trustlines, and acquires test USDC through the testnet DEX using faucet XLM. It deploys a fresh contract and updates the public frontend configuration. It never uses mainnet, substitutes a different USDC issuer, or writes signing keys into the repository. Rebuild/restart the frontend after changing the deployment. If testnet DEX liquidity or Friendbot is unavailable, the command reports the actual error; it does not silently use another token.

Create three fresh receipts for an entirely website-driven walkthrough:

```sh
python3 scripts/demo.py prepare --stage held
```

This registers custody for three different rug IDs. Each can independently go through acceptance, commitment, funding, and its outcome in the website. The returned URLs and receipt library make the IDs accessible. Repeat preparation whenever you need another set; no receipt is reset or reused.

For a presentation starting at settlement, pre-accept and fund all three receipts through the CLI:

```sh
python3 scripts/demo.py prepare --stage ready --duration 900 --default-duration 60
```

The normal-sale and repayment receipts get 900-second funding durations; the fallback receipt gets 60 seconds. These durations are visible in the accepted terms and recorded deadlines. The website's proposed default is 300 seconds and can be changed before acceptance; use 60 seconds for a fast interactive default demonstration. `--stage accepted` is also available to stop after weaver acceptance, before dealer commitment/funding.

Receipt metadata is served from `frontend/public/demo-receipts.json`, fetched without caching; preparing more receipts does not require another frontend build for discovery. Preparation also writes a public transaction record under `docs/`. It never puts private keys into that manifest.

For the deployment created in this session, the matching external state directory is `/private/tmp/rug-full-demo` and the installed CLI is `/private/tmp/rug-stellar-cli/stellar`:

```sh
export RUG_DEMO_HOME=/private/tmp/rug-full-demo
export STELLAR_CLI=/private/tmp/rug-stellar-cli/stellar
python3 scripts/demo.py prepare --stage held
```

These temporary paths are local to this computer and may be cleared by the operating system. Preserve the identity directory privately if you need continued signing with these addresses. On a different computer, run `deploy` with a new external directory to create a separate deployment.

## Website walkthrough with separate wallets

Import the five local demo identities into separate Varial / Freighter accounts privately, or arrange a fresh deployment with the wallets that will play the roles. For this deployment, use the nominated public addresses in [the public configuration](../frontend/demo/deployment.json). The configured warehouse's wallet is required for registration. The CLI identities are not automatically available in the browser wallet. To retrieve a local demo key for your own private import, use the CLI's `keys secret` command with `--config-dir "$RUG_DEMO_HOME/config"` and its `demo-warehouse`, `demo-weaver`, `demo-lender`, `demo-dealer`, or `demo-buyer` alias. Do not send those secret outputs to chat or commit them.

1. **Warehouse:** open `/warehouse`, connect the configured warehouse wallet on Testnet, enter rug display metadata and weaver address, and sign **Confirm custody & register rug**. Select that receipt for the next steps. A prepared `Held` receipt already has this step completed.
2. **Weaver:** switch Varial to the nominated weaver and reconnect on `/weaver`. Review every term and both nominated parties. Accept exactly 8 advance, 9 lender repayment, 1 custody fee, 10 fallback price, and the chosen duration. These terms become immutable.
3. **Dealer:** switch to the nominated dealer on `/dealer`. Review the identical full terms and accept the fallback commitment. This is a promise to pay, not escrow, a token allowance, or a guarantee of repayment.
4. **Lender:** switch to the nominated lender on `/lender`. Inspect custody, terms, dealer commitment, and balance. Sign the 8-USDC advance. Funding success starts the ledger deadline.
5. **Choose one outcome per receipt:**
   - **Normal sale:** before the deadline, the weaver approves 15 test USDC. On `/buyer`, connect the buyer, review the live price, and sign. Verify lender +9, warehouse +1, weaver +5, buyer −15. Pickup recipient is the buyer.
   - **Direct repayment:** on `/weaver`, pay 10 test USDC while active or overdue. The advance alone is only 8, so the weaver needs 2 additional tokens. Verify lender +9, warehouse +1, weaver −10 from this repayment. Pickup recipient is the weaver; no buyer is recorded.
   - **Default:** wait until `/dealer` reads `Overdue`. Before payment, the rug must remain locked. Sign the committed 10-USDC dealer purchase. Verify lender +9, warehouse +1, dealer −10, no new weaver surplus. Pickup recipient and purchaser are the dealer.
6. After confirmed settlement, inspect the warehouse record, transaction link, and pickup recipient. Reload and switch roles: the same receipt cannot be funded or settled again.

The deadline is determined by Stellar ledger time. A client clock never grants settlement permission. After the deadline, a sale is unavailable, but repayment remains available until one successful final outcome wins in ledger order.

## Wallet setup and recovery

If the wallet needs XLM, use the page's testnet Friendbot link. If it lacks a Circle USDC trustline, use **Review & approve USDC trustline** and sign in Varial. The helper adds a 1000-test-USDC capacity trustline; it does not purchase tokens. The issuer must be `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.

To top up a public testnet wallet after its trustline is approved:

```sh
python3 scripts/demo.py fund-wallet G_PUBLIC_ADDRESS --amount 15
```

This tops up to the specified balance rather than sending that amount repeatedly. It can fund test XLM first, but cannot create a trustline for a wallet whose key is not in the local tooling; the user signs that action in the website.

Rejected signatures never submit a transaction. Wrong network/wallet, missing trustline, and insufficient funds produce an actionable message. A submitted hash is saved before network submission; pending state survives role navigation/reload. **Refresh status** checks confirmation before allowing another action. Known on-chain failures keep pickup locked. Unknown/slow responses remain pending, with an explorer link, until confirmation or time-bound expiry; receipt state is rechecked before any later attempt.

## CLI verification without browser signing

```sh
python3 scripts/demo.py prepare --stage ready --duration 900 --default-duration 60
python3 scripts/demo.py exercise
python3 scripts/demo.py verify
```

`exercise` spends test tokens to settle all three latest prepared receipts using their separate local identities. It waits for the fallback deadline. Run it only when you intend to consume those receipts. It rejects receipts that already have a final state.

`verify` is **strictly read-only on-chain**: it finds the matching successful transactions from the external transaction log, verifies the receipt IDs and exact USDC transfer deltas through Horizon, and simulates `get_receipt`. It writes public evidence to `docs/full-demo-testnet.json`. Use it after a transient read timeout; do not resubmit a payment to recover a report.

## Persistence limits

Display names/descriptions and receipt discovery use the checked-in public manifest plus local browser metadata. Locally registered metadata survives reloads in that browser; clearing local storage loses it. **Copy receipt library** exports the public IDs and metadata, and manually loading a receipt ID works on another device. No Supabase database, global rug catalog, physical image verification, or production indexing service is included. Contract data remains the financial source of truth. Keys and complete local CLI logs remain outside tracked files.

See [the API](full-demo-api.md), [verification results](full-demo-verification.md), and [design choices](full-demo-decisions.md).
