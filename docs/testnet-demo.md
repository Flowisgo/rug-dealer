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

Override the state directory with `RUGDEALER_STATE` if needed. The script refuses to use a directory inside the repository. The repository only receives public data:

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
- The `demo` command refuses to run a scenario if its store is already frozen; run `deploy` again for a fresh contract.

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
