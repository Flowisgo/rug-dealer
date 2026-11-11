# Full loan demo contract API

This reference describes `codex/full-loan-demo`, based on the contract in PR #3. It is a new deployment with a new receipt schema; it does not upgrade or reinterpret receipts in the original contract. Public deployment IDs and accounts are in [the deployment record](full-demo-deployment.json) and `frontend/demo/deployment.json`.

## Token units and terms

All token amounts are signed `i128` integers in seven-decimal Circle testnet USDC units. One test USDC is `10000000`. Durations and ledger timestamps are unsigned `u64` seconds.

`LoanTerms` contains **all seven fields**, signed together by the weaver and separately by the nominated dealer:

| Field | Demo default | Meaning |
| --- | --- | --- |
| `advance` | `80000000` | Amount transferred from lender to weaver on funding |
| `lender_due` | `90000000` | Amount repaid to lender at any settlement |
| `custody_fee` | `10000000` | Fixed warehouse fee paid at settlement |
| `fallback_price` | `100000000` | Committed dealer purchase price after deadline |
| `duration_secs` | `300` | Duration measured from successful funding; adjustable to 30–86400 seconds before acceptance |
| `lender` | Address | Only this wallet can fund |
| `dealer` | Address | Only this wallet can accept and pay the fallback commitment |

Advance must be positive, lender repayment must cover the advance, custody fee must be nonnegative, and fallback price must cover lender repayment plus custody. Overflow is rejected. Weaver-approved sale prices must also cover repayment plus custody. Terms cannot be replaced once accepted, even before funding. Dealer authorization must match the full accepted struct, not just a price or address.

## Calls

Every `id` is a `BytesN<32>` receipt identifier (64 hexadecimal characters in CLI/website input). Entry points return `Result<_, Error>` except read-only defaults/clock. The deployment constructor receives the fixed warehouse and the seven-decimal token contract; configuration is immutable.

| Function | Required authorization | Behavior |
| --- | --- | --- |
| `loan_terms()` | None | Read numeric demo defaults (not a particular rug's accepted terms). |
| `ledger_time()` | None | Read the current ledger timestamp for deadline display. |
| `register_receipt(id, weaver)` | Configured warehouse | Attest physical custody. Create `Held`; receipt IDs cannot be reused. |
| `accept_terms(id, terms)` | Receipt's weaver | Validate and freeze the exact terms; move to `TermsAccepted`. |
| `accept_fallback(id, terms)` | Accepted terms' dealer | Authorize the exact fallback promise and conditions. Only once, before funding. No funds move. |
| `fund_loan(id)` | Accepted terms' lender | Requires weaver acceptance and dealer commitment. Transfer the advance, record `funded_at` and `deadline`, and become `Active` atomically. |
| `approve_sale(id, price)` | Weaver | Approve or change the exact sale price while active and before deadline; credit terms remain unchanged. |
| `buy(id, buyer, payment)` | Buyer | Before deadline only; pay exactly the approved price. Atomic settlement to `SaleSettled`; record buyer and buyer pickup rights. |
| `repay(id)` | Weaver | While active or overdue, pay `lender_due + custody_fee`. Settle to `Repaid`; pickup recipient is weaver and `buyer` remains unset. |
| `dealer_buy(id)` | Committed dealer | At or after deadline, pay the exact fallback price. Settle to `DealerPurchased`; record dealer as buyer and pickup recipient. |
| `get_receipt(id)` | None | Read accepted terms, commitments, ledger times, state, purchaser, and pickup rights. |

The source wallet also authorizes nested token transfers. Browser clients prepare the full Soroban transaction with its authorization entries, then sign with the same required wallet on testnet. Switching role pages changes navigation, never authorization.

## Receipt fields

- `weaver`: warehouse-identified owner.
- `terms`: `Financing::Unaccepted` or `Financing::Accepted(LoanTerms)`. CLI JSON encodes the accepted variant as `{"Accepted": {...}}`; the JS SDK's native representation is `["Accepted", {...}]`. The frontend normalizes this to `Terms | null`.
- `dealer_committed`: exact accepted terms have been authorized by their nominated dealer.
- `approved_price`: separately approved sale price, or unset.
- `funded_at`, `deadline`: ledger seconds, both unset until a successful advance. `deadline = funded_at + duration_secs`.
- `stage`: `Held`, `TermsAccepted`, `Active`, `Overdue`, `SaleSettled`, `Repaid`, or `DealerPurchased`.
- `buyer`: successful purchaser (buyer or dealer), unset before settlement and on direct repayment.
- `pickup_recipient`: buyer, repaying weaver, or dealer after successful settlement; unset otherwise.
- `ready_for_pickup`: false until all required payouts succeed.

`Overdue` is calculated by `get_receipt` from ledger time; no keeper or state-changing default transaction is needed. At **exactly** the deadline, the normal sale closes and dealer purchase opens. Repayment remains valid until settled. The frontend refreshes contract status periodically and enables dealer purchase only when the returned state is `Overdue`.

## Exact demo outcomes

| Outcome | Payer | Paid | Lender | Warehouse | Weaver surplus | Pickup recipient |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Normal sale | Buyer | 15 | 9 | 1 | 5 | Buyer |
| Direct repayment | Weaver | 10 | 9 | 1 | 0 | Weaver |
| Fallback purchase | Dealer | 10 | 9 | 1 | 0 | Dealer |

The earlier 8-token advance is separate. A weaver starting with only that advance needs 2 additional tokens to repay 10. A dealer's commitment is an authorized promise, **not escrow, an allowance, automatic payment, or a repayment guarantee**. An unpaid overdue loan stays locked. A failed incoming payment or any payout rolls back all transfers and state. A fallback higher than 10 sends its surplus to the weaver; zero transfers are skipped. No settled receipt may be funded or settled again, and its pickup recipient cannot be replaced.

## Errors

`ReceiptExists (1)`, `ReceiptMissing (2)`, `WrongStage (3)`, `PriceNotApproved (4)`, `InvalidAmount (5)`, `TermsMismatch (6)`, `DeadlinePassed (7)`, `TooEarly (8)`, `DealerNotCommitted (9)`, `InvalidDuration (10)`. Missing signatures and token errors also surface as host failures. Frontend simulation failures do not imply a submitted transaction; submitted hashes are polled for confirmed success/failure before refreshing the receipt.

## Persistence and physical limits

Receipt entries and deployment configuration are extended to 200000 ledgers on writes. There is no production archival-restoration or monitoring service in this prototype. The warehouse remains trusted for appraisal, custody, unique physical-rug identification, and handoff. A wallet recipient records pickup clearance, not physical delivery. See [reversible design choices](full-demo-decisions.md) and [demo instructions](full-demo.md).
