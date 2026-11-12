# Testnet deployment and demo

`scripts/testnet.py` deploys RugDealer to Stellar Testnet and runs the three settlement paths. It is cross-platform Python 3.10+ and drives the Stellar CLI. All secret keys stay in a Stellar CLI config directory outside the repository.

## Prerequisites

- Stellar CLI 30.x (`stellar --version`)
- Python 3.10+
- Network access to Testnet RPC and Friendbot
- Rust/wasm target only if you want the script to rebuild the contract

## State and secrets

By default the script uses:

```text
~/.rugdealer-demo/config      Stellar CLI identities (contains secrets)
~/.rugdealer-demo/logs        command logs
```

Override the key directory with `RUGDEALER_STATE`, the public manifest with `RUGDEALER_MANIFEST`, and results with `RUGDEALER_RESULTS`. Use absolute paths for all three. A state-directory override alone does not select a deployment. The script refuses to use a directory inside the repository. The repository only receives public data:

```text
docs/testnet-deployment.json
docs/testnet-demo-results.json
```

Never commit the state directory or paste a secret key into a doc.

## Commands

```bash
# Build, create/fund accounts, deploy test USDC and RugDealer, register stores
python scripts/testnet.py deploy

# Run all three scenarios (repay, buy-out, claim)
python scripts/testnet.py demo --scenario all

# Individual scenario
python scripts/testnet.py demo --scenario repay
python scripts/testnet.py demo --scenario buyout
python scripts/testnet.py demo --scenario claim

# Print current config and store state
python scripts/testnet.py status
```

`deploy` options:

| Option | Default | Meaning |
|---|---:|---|
| `--interest-bps` | 1500 | Annualized investor interest |
| `--platform-bps` | 100 | Platform fee, once |
| `--store-bps` | 25 | Store fee per month |
| `--max-months` | 12 | Maximum loan length |
| `--month-seconds` | 60 | Demo month length |
| `--window-seconds` | 60 | Buy-out window |
| `--store-limit` | 5000 | Store principal limit, whole USDC |
| `--rug-price` | 600 | Demo rug price, whole USDC |

## What deploy does

1. Creates or reuses six Stellar CLI identities: admin, USDC issuer, main store, claim-demo store, weaver, investor.
2. Funds accounts with testnet XLM through Friendbot.
3. Deploys the test `USDC:<issuer>` SAC and creates USDC trustlines for the demo accounts.
4. Mints demo USDC to the admin, stores, weaver, and investor.
5. Builds `target/wasm32v1-none/release/rugdealer.wasm`.
6. Deploys RugDealer with all Money Rules as constructor parameters.
7. Registers both stores with the configured USDC principal limit.
8. Writes `docs/testnet-deployment.json` with public keys, IDs, parameters, deploy transaction hash, deploy ledger, and transaction hashes.

A second `deploy` creates a new RugDealer contract with the same accounts. This resets all per-contract store and rug state, including frozen flags.

## Demo scenarios

The script creates a fresh rug and loan for each scenario, snapshots USDC balances before funding, settles, and asserts exact deltas, loan status, rug owner, and store principal release.

| Scenario | Loan | What happens | Exact USDC deltas |
|---|---|---|---|
| `repay` | 600 USDC, 6 months | Weaver repays | Investor +45, weaver −60, store +9, admin +6, contract 0 |
| `buyout` | 600 USDC, 1 month | Store buys out inside the window | Investor +7.5, weaver +585, store −598.5, admin +6, contract 0 |
| `claim` | 600 USDC, 1 month | Store misses; investor claims | Investor −592.5 and receives the rug, store2 +1.5, weaver +585, admin +6, contract 0 |

Notes:

- The buy-out scenario uses the main store.
- The claim scenario uses `store2`, which becomes frozen and emits `store_frozen` with reason `MissedBuyout`.
- The main store remains active after the demo, so the frontend can keep minting new rug certificates with it.
- The claim investor keeps the rug certificate and can redeem it with the store’s signature.
- The `demo` command preflights **all** selected stores, capacity, identities and contract parameters before its first write; it refuses if any store is already frozen; run `deploy` again for a fresh contract.

The live demo exercises normal investor receipt. The deauthorized-investor credit fallback is covered by `cargo test`: `repay`, `store_buyout` and `claim_rug` still close the loan, record the exact credit, and `withdraw_credit` pays it once the investor can receive again.

## Current testnet deployment

| Item | Value |
|---|---|
| Contract | `CCX3Z3DJ7KS6YCSWQCIOJWFZCB76A7SD7LJI6BHDILO5FGSI6ZJJ4M2J` |
| Deploy ledger | `5,698,981` |
| USDC SAC | `CCKKWM4ROXHPJAALYDXWL676MUB6OKGSWAZUOTB5SJIBWQ3B5ZDQZ3OM` |
| USDC asset | `USDC:GAWNPX6FZB7B7TZP6WC2H6L7AOYRXPBRDBWPISSAIFQPZX7GAQO3TWRY` |
| Admin / fee recipient | `GCXRZRWAXQ2HDXIUAC5BZRZOLMD3RGLU42K64VHWCQV57CGXJWQTVCIZ` |
| Main store | `GBWCNPACZXNZKJKB7NA2EHRCZTNWT3LQBEHTYPTVF5X6VZNU5RXPPLCN` |
| Claim-demo store | `GDWBZD65XOYVVDMQHOST5SEQH4ZBXZTADY3NJIOGMYSYYVGK5RAFZ5RQ` |
| Weaver | `GBH4TKU2HPW7PGY5BCDU73E3PMZUK7TQ7RVDHP5QDTK23BHKW2XDGOQF` |
| Investor | `GCVBINDMVFUMQ3OBUVQGE6RFBWWBHSRKSLEQVZ6I7XQNQR2424HQOA2W` |

See `docs/contract-interface.md` for the full API and `docs/testnet-demo-results.json` for the verified scenario records.

## Isolated rehearsal and web configuration

Never rehearse writes against the shared deployment. In a separate checkout, with Node dependencies installed and Rust/wasm and Stellar CLI available:

```bash
export RUGDEALER_STATE="$(mktemp -d /tmp/rugdealer-keys.XXXXXX)"
export RUGDEALER_MANIFEST="$RUGDEALER_STATE/deployment.json"
export RUGDEALER_RESULTS="$RUGDEALER_STATE/results.json"
python3 scripts/testnet.py deploy
python3 scripts/testnet.py status
python3 scripts/testnet.py demo --scenario all
cd frontend
npm ci
npm run build
npm start
```

`deploy` writes the complete public manifest: Testnet network, contract ID, deployment ledger/hash, SAC, `USDC:<issuer>`, issuer, admin/fee recipient, both stores, weaver, investor, fee/timing parameters, WASM hash, and feature flags. This prototype creates its **own test USDC issuer**, not Circle's asset. Every paying/receiving account needs test XLM and that exact issuer's USDC trustline. Six aliases in the selected key directory must match the manifest. Keep secrets private and outside Git. Only the public manifest is needed on a build host; publish its reviewed contents as `docs/testnet-deployment.json`, or provide its absolute build-time path in `RUGDEALER_MANIFEST`.

Frontend npm commands generate `lib/deployment-data.json` from that manifest; do not copy individual constants. Rebuild after changing it. On Vercel, retain root `frontend/` and include the repository's `docs/` directory in the build inputs. Testnet passphrase/RPC/Horizon/Friendbot/explorer defaults are in `lib/deployment.ts`; the script uses the CLI's `testnet` network plus Testnet Horizon and Friendbot. Verify `stellar --config-dir "$RUGDEALER_STATE/config" network info --network testnet` before a signed rehearsal.

The new contract supports `store_count`/`store_at` for durable store discovery (`features.store_index: true` on fresh deploy). The checked-in older deployment lacks these views; its frontend still directly looks up the connected store and offers admin address lookup when events have expired. Do not enable the flag for an old contract. The deadline-overflow fix also requires a fresh contract deployment; the current demo's 60/60-second settings are unaffected.

Timing is checked against **closed ledger timestamps**. The CLI polls Horizon, then simulates each timed action before sending. Only unsigned too-early simulations are retried. If a signed submission has an uncertain outcome, inspect its hash before trying again. A 60-second buy-out window leaves little time for manual wallet signing: stage the buy-out account first. Claim freezes store2, so `all` is a one-pass rehearsal per deployment; redeploy for another full run.

Local script regressions (fake external CLI, no network writes):

```bash
python3 -m unittest discover -s scripts/tests -v
```
