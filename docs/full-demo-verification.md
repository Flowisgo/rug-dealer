# Full loan demo verification

Verified on November 10, 2026 in America/Toronto (transaction timestamps fall on November 11 UTC). Branch: `codex/full-loan-demo`, based on `codex/first-loan-flow`, with the buyer frontend incorporated. No merge into the base branch is requested.

## Fresh deployment

- [Contract on Stellar testnet](https://stellar.expert/explorer/testnet/contract/CAHEWX6WTJLTOMDYIPYVUBO5TAVKAFSMDPUXRVDYTNP4COZWXWYU6ZKC): `CAHEWX6WTJLTOMDYIPYVUBO5TAVKAFSMDPUXRVDYTNP4COZWXWYU6ZKC`.
- [Deployment transaction](https://stellar.expert/explorer/testnet/tx/257e6115b1dde252a8ed1166fe4608d80e385189a178178b0bedc9aa6a64443a).
- Circle testnet USDC SAC: `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.
- Issuer: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
- WASM SHA-256: `493191fd68ab7a5fbe08f73fac12c40207b2fac268b716d632523e6f72d27b17`.
- [Public deployment record](full-demo-deployment.json) and [five separate role addresses](../frontend/demo/deployment.json). Signing keys and full CLI logs remain outside the checkout.

## CLI-signed testnet outcomes

Separate local warehouse, weaver, dealer, lender, and buyer identities completed custody registration, exact weaver acceptance, exact dealer commitment, the 8-USDC advance, and sale-price approval. Funding started the ledger deadline. All settlements below succeeded against the fresh contract using actual Circle testnet USDC.

These are settlement-only USDC balance changes. The earlier advance separately moves 8 from lender to weaver; test XLM fees are separate.

| Outcome | Payer | Lender | Warehouse | Weaver surplus | Final state / pickup |
| --- | ---: | ---: | ---: | ---: | --- |
| [Normal sale](https://stellar.expert/explorer/testnet/tx/3bf2c8c80fcea0b8fdaf8c2efabfdd95c699d8e081008b9ff4cc784b0554a9dd) | Buyer −15 | +9 | +1 | +5 | SaleSettled / buyer |
| [Direct repayment](https://stellar.expert/explorer/testnet/tx/fb4b98b467c2db734cad4052ed6b421259167e8af688db15a3db0a17fa29b773) | Weaver −10 | +9 | +1 | 0 | Repaid / weaver |
| [Dealer purchase](https://stellar.expert/explorer/testnet/tx/a808dda216f91d27a44aaa03578392a37478e65fc9bfb1f76b2a49367520be1f) | Dealer −10 | +9 | +1 | 0 | DealerPurchased / dealer |

Every final receipt has `ready_for_pickup: true`. The normal sale records the buyer; dealer purchase records the dealer; repayment leaves `buyer` unset and records the weaver as pickup recipient. Each settlement's contract net token change is zero. [Machine-readable evidence](full-demo-testnet.json) contains full IDs, final receipts, and deltas verified from successful Horizon transfer records. `verify` independently checked receipt IDs, exact transfers, and final state without submitting another payment. A transient HTTP timeout after the CLI exercise was recovered through this read-only verification.

## Local checks

- `cargo test --workspace --locked`: **18 passed, 0 failed**. Tests use public Soroban calls and real token balances in the local host.
- `cargo fmt --all -- --check`: passed.
- `cargo clippy --workspace --all-targets --locked -- -D warnings`: passed.
- `stellar contract build --locked`: passed; that WASM was deployed.
- Frontend `npm run typecheck`: passed.
- Frontend `npm run build`: passed; root and all five role routes generated.
- `python3 -m py_compile scripts/demo.py`: passed.
- `git diff --check`: passed.

Coverage includes exact payouts for all three outcomes; per-rug terms; missing/wrong signatures; mismatched dealer terms; dealer replacement prevention; invalid amounts and durations; overflow; missing sale approval; exact sale payment; failed advance; early dealer purchase; ledger deadline boundaries; repayment before/at/after deadline; duplicate receipt/funding; repeat settlement; separate receipts; unpaid overdue pickup lock; failed payout rollback and retry; and preservation of final purchaser/pickup rights. Tests were added through red/green steps at the previously confirmed public-contract/token-balance boundary.

## Frontend RPC integration

[Read-only smoke evidence](full-demo-rpc-smoke.json) uses the website's actual receipt and terms encoder and Stellar SDK transaction assembly against the deployed contract. Across Held, TermsAccepted (before and after dealer commitment), Active, and Overdue, all eight write entry points simulated successfully: `register_receipt`, `accept_terms`, `accept_fallback`, `fund_loan`, `approve_sale`, `buy`, `repay`, and `dealer_buy`. These simulations did not sign or submit transactions. The receipt stage stayed unchanged except for natural ledger-time expiry.

## Browser inspection of production app

The in-app browser loaded the production app at http://127.0.0.1:3000 with live RPC reads and no mocked wallet or contract responses.

- All five role routes and navigation preserved the selected receipt. The shared library picked up newly prepared receipts without rebuilding.
- Warehouse showed custody registration inputs and the required warehouse address. Final sale showed its actual buyer and pickup clearance.
- Weaver showed all seven proposed terms, default 8/9/1/10/300, and nominated lender/dealer addresses for a fresh Held rug. Accepted terms became read-only. An overdue rug still offered 10-USDC repayment.
- Dealer showed the exact accepted terms, promise-to-pay explanation, and commitment action before funding. An unpaid Overdue rug showed the 10-USDC fallback payment action, no purchaser/recipient, and locked pickup. Its paid counterpart showed DealerPurchased and the dealer's recorded address.
- Lender showed warehouse custody, weaver acceptance, dealer commitment, 8 advance, 9 due, 1 fee, and the funded deadline. A funded rug could not be funded again.
- Buyer showed the live approved 15-USDC price and 9/1/5 split. Overdue sale was closed while repayment/dealer purchase remained the next actions. Settled receipts showed their final recipient.
- Direct repayment's final warehouse record showed Repaid, no purchaser, the weaver pickup address, and Ready for pickup.
- Connect in the extension-free in-app browser showed an actionable Varial / Freighter unavailable message. Signing controls remained disabled without the required wallet.
- Desktop and 390×844 mobile views retained the existing palette and rug design. The mobile role navigation, stacked layout, financing inputs, action, and receipt record fit the viewport. Temporary viewport override was reset after testing.

[Desktop screenshot](screenshots/full-demo-desktop.jpg) · [Mobile screenshot](screenshots/full-demo-mobile.jpg).

## Remaining wallet verification

**No new full-demo transaction was signed through Varial in this run.** The earlier successful user Varial purchase in [the historical browser report](../frontend/BROWSER-CHECKS.md) used the previous contract. The new deployment's writes were CLI-signed. Wrong-network, signature-rejection, insufficient-balance, pending/reload, and failure recovery paths are implemented and reviewed but were not exercised through a live browser wallet in this run.

To complete wallet acceptance testing:

1. Open the production app in Chrome with Varial / Freighter on Testnet. Privately import the five demo identities from the external identity directory, or use a fresh deployment with your own separate role wallets; do not send secrets to chat.
2. Select one of the three fresh Held receipts below. Warehouse registration is already complete. As weaver, review and accept terms; as dealer, accept the identical commitment; as lender, fund 8.
3. For the sale receipt, have the weaver approve 15 and buyer sign payment before the deadline. For repayment, have the weaver sign 10. For default, choose a short duration at acceptance, wait for Overdue, then have the dealer sign 10. Reconnect after switching wallet accounts.
4. Check confirmation, transaction links, exact payouts, and final pickup addresses. Reload during a pending action and after confirmation. Also exercise rejection, wrong-network, and insufficient-balance messages with fresh receipts as needed.

The configured demo identities already have test XLM and Circle USDC. A different buyer needs its own signed Circle trustline and at least 15 test USDC. The [setup guide](full-demo.md) includes the trustline helper and public-address funding command.

## Fresh unused presentation receipts

All three were registered through the warehouse CLI and left in Held, with no accepted terms, funding, deadline, sale, or pickup clearance. They appear first in the receipt library:

- Normal sale: `e8de45fb185fc95c6b724226c84bba172a96eae742a3cde478c90b80d59f2e34`.
- Direct repayment: `241bc29ad1f2492aefd35e6c59da27726d6a21c6e690b8940faa499a91c525e1`.
- Dealer default: `eff1cb129a7bd5e30a92a74338b94139e799d45bd5f760999ccb3d8069ccc484`.

[Preparation transactions](full-demo-preparation.json). Run `python3 scripts/demo.py prepare --stage held` for another independent set, or use `--stage ready --duration 900 --default-duration 60` to prepare all financial steps through the CLI. A completed receipt is never reset. The separate browser fixture `9b2ee2…536a` deliberately remains unpaid and Overdue to demonstrate that a commitment alone does not release custody.
