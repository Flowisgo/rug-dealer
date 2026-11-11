# Full rug-loan demo frontend

Five Next.js role pages use the fresh full-demo Soroban deployment: `/warehouse`, `/weaver`, `/dealer`, `/lender`, and `/buyer`. The cream, dark-green, and terracotta buyer design is retained.

## Run

Use Node.js 24 LTS and npm:

```sh
cd frontend
npm ci
npm run typecheck
npm run build
npm start
```

Open http://127.0.0.1:3000 in Chrome with Varial / Freighter on Stellar Testnet. `npm run dev` is available for development. The website needs no environment variables or private keys. Each transaction is signed by the connected role's wallet; navigation does not change authorization.

## Configuration and fresh receipts

The public [deployment configuration](demo/deployment.json) selects contract `CAHEWX6WTJLTOMDYIPYVUBO5TAVKAFSMDPUXRVDYTNP4COZWXWYU6ZKC`, Circle testnet USDC, and five separate demo addresses. It replaces the original buyer-only deployment on this branch. The old Varial purchase remains historical evidence in [BROWSER-CHECKS.md](BROWSER-CHECKS.md).

From the repository root, using the deployment's external identity directory:

```sh
python3 scripts/demo.py prepare --stage held
```

This creates three new registered receipts, publishes their URLs, and updates the runtime [receipt library](public/demo-receipts.json). Each new receipt starts locked and can be used independently. The library is fetched without caching, so a new preparation does not require a frontend rebuild. Deploying a different contract does require rebuilding.

See the [complete setup and five-wallet walkthrough](../docs/full-demo.md) for the identity directory, funding commands, short deadlines, all three outcomes, and CLI verification. Never paste a private signing key into the app or repository.

## Data and transaction behavior

Display names and descriptions come from the public manifest and local browser metadata. The rug SVG is illustrative. Financial terms, commitment, price, stage, ledger deadline, purchaser, and pickup rights come from the live contract. Local metadata is not a shared database; clearing browser storage loses locally registered display information. Receipt IDs can be copied and loaded on another device.

Before signing, the app checks the active wallet, Testnet passphrase, current receipt, trustline, and available balance. It simulates and assembles Soroban authorization entries, then verifies the signed transaction body and signer. A hash is persisted before submission. Confirmation is polled; unknown responses remain pending across reloads. Final receipt state is refreshed after confirmation. Failed actions never optimistically clear pickup. Time-bound expiry permits review and retry only after checking the chain again.

The wallet panel links to test XLM funding and offers a user-signed Circle USDC trustline helper. USDC funding still requires actual test tokens. A dealer commitment is a promise to pay; it does not escrow tokens or settle an overdue rug by itself.

## Verification

[Current full-demo results](../docs/full-demo-verification.md) distinguish local tests, CLI-signed testnet settlements, read-only frontend RPC simulations, and browser inspection. New role-wallet approval prompts still require manual Varial testing.

The read-only smoke command uses the frontend's real encoding, simulates the actions available for a receipt's current stage, and assembles transactions without signing or submitting:

```sh
npm run smoke:rpc -- RECEIPT_ID
```

It writes public evidence to `docs/full-demo-rpc-smoke.json`. Use a held, accepted, active, or overdue receipt; the report records which actions were actually available.
