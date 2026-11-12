# RugDealer contract interface

Status: **milestones 1–3 complete** — contract core, buy-out/claim path, and testnet deployment.

The contract is a single Soroban contract at `contracts/rugdealer`. It records stores, rug certificates, loans, USDC payments, and settlement state. Rugs are **not** Stellar assets: each rug is an NFT-style record inside the contract with a contract-assigned `id`. USDC is a Stellar Asset Contract (SAC).

## Deployment parameters

`__constructor` takes all of these. Invalid values abort deployment.

| Parameter | Type | Default | Notes |
|---|---|---:|---|
| `admin` | `Address` | — | Platform admin. Signs `register_store`, `set_store_limit`, `freeze_store`. |
| `usdc` | `Address` | — | USDC SAC address. Must report 7 decimals. |
| `fee_recipient` | `Address` | — | Receives the platform fee at funding. |
| `interest_bps_per_year` | `u32` | 1500 | Investor interest, annualized basis points. 1500 = 15%/year. |
| `platform_fee_bps` | `u32` | 100 | Platform fee, charged once at funding. 100 = 1%. |
| `store_fee_bps_per_month` | `u32` | 25 | Store fee per month. 25 = 0.25%/month. |
| `max_months` | `u32` | 12 | Maximum loan length in whole months. Must be 1–12. |
| `month_seconds` | `u64` | 2,592,000 | Seconds in a loan month. Demo deployment uses 60. Must be > 0. |
| `buyout_window_seconds` | `u64` | 604,800 | Store buy-out window after `end_at`. Demo deployment uses 60. Must be > 0. |

Validation:
- `month_seconds > 0`, `buyout_window_seconds > 0`.
- `1 <= max_months <= 12`.
- Each bps value is at most 10,000.
- Combined maximum fee at `max_months` is below 10,000 bps, so a weaver payout can never underflow.
- The USDC SAC returns exactly 7 decimals.

## Money rules

For a loan of `principal` over `months`:

```text
interest      = floor(principal × interest_bps_per_year × months / (10_000 × 12))
platform_fee  = floor(principal × platform_fee_bps / 10_000)
store_fee     = floor(principal × store_fee_bps_per_month × months / 10_000)
weaver_payout = principal − interest − platform_fee − store_fee
investor_payout = principal + interest
```

Each fee component rounds down independently. The leftover from rounding goes to `weaver_payout`, so:

```text
interest + platform_fee + store_fee + weaver_payout == principal
```

Fees are taken at `fund_loan`. Early repayment does not refund any fee.

### Worked example

$600 principal, 6 months, default parameters:

| Item | Amount |
|---|---:|
| Principal | 600.0000000 USDC |
| Interest | 45.0000000 USDC |
| Platform fee (once) | 6.0000000 USDC |
| Store fee | 9.0000000 USDC |
| Weaver receives at funding | 540.0000000 USDC |
| Investor receives on repay or store buy-out | 645.0000000 USDC |

The contract stores and emits amounts in 7-decimal base units, e.g. `6000000000` = 600.0000000 USDC.

## Public functions

All amounts are `i128` in 7-decimal base units. `loan_id` and `rug_id` are `u64`. Every state-changing function returns `Result<(), Error>` unless noted.

### `__constructor`

```rust
__constructor(
    admin: Address,
    usdc: Address,
    fee_recipient: Address,
    interest_bps_per_year: u32,
    platform_fee_bps: u32,
    store_fee_bps_per_month: u32,
    max_months: u32,
    month_seconds: u64,
    buyout_window_seconds: u64,
)
```

Signer: none (runs at deployment). Stores `Config`, initializes `NextRugId = 1` and `NextLoanId = 1`.

Invalid parameters abort deployment with `InvalidConfig`.

### `register_store(store, limit)`

Signer: `admin`.

Creates a store with a USDC principal limit. `limit` is the maximum outstanding principal in USDC base units. Fails with `StoreAlreadyRegistered` if the store already exists. Use `set_store_limit` to change it. Emits `store_registered`.

Errors: `InvalidLimit`, `StoreAlreadyRegistered`.

### `set_store_limit(store, limit)`

Signer: `admin`.

Updates an existing store’s principal limit. The limit may be lowered below current `open_principal`; existing loans are unaffected, but new requests and unfunded requests are refused until `open_principal <= limit`. Emits `store_limit_set`.

Errors: `InvalidLimit`, `StoreNotRegistered`.

### `freeze_store(store)`

Signer: `admin`.

Sets `Store.frozen = true`. Freeze blocks **only `mint_rug`**. It does not block `request_loan` or `fund_loan`. Emits `store_frozen` with reason `Platform` on the first freeze. Idempotent.

Errors: `StoreNotRegistered`.

### `mint_rug(store, weaver, description, price) -> rug_id`

Signer: `store`.

Creates an in-contract rug certificate owned by `weaver` with the given description and USDC price. The contract assigns `rug_id` from `NextRugId`. No Stellar asset, SAC, or trustline is created.

Requirements:
- store is registered and not frozen
- `weaver` is not a registered store (any store, including `store` itself)
- `price > 0`
- description length is 1–280 bytes

Emits `rug_minted`.

Errors: `StoreNotRegistered`, `StoreFrozen`, `WeaverIsStore`, `InvalidPrice`, `InvalidDescription`.

### `request_loan(weaver, rug_id, months) -> loan_id`

Signer: `weaver`.

Creates a loan request for exactly `Rug.price` over `months` whole months (`1..=max_months`).

Requirements:
- `weaver` is not a registered store
- `Rug.owner == weaver`
- `Rug.status == Free`
- `1 <= months <= max_months`
- `Store.open_principal + Rug.price <= Store.limit`

Effects:
- `Rug.status = Requested`
- `Store.open_principal += Rug.price`
- loan status `Requested`
- quote amounts are stored on the loan for later settlement

Emits `loan_requested`.

Errors: `RugNotFound`, `NotRugOwner`, `RugNotFree`, `StoreCannotBorrow`, `InvalidMonths`, `StoreNotRegistered`, `InvalidAmount`, `StoreLimitExceeded`.

### `cancel_request(loan_id)`

Signer: `Loan.weaver`.

Only valid while the loan is `Requested` (not funded). Returns the rug to `Free`, clears the store’s reserved principal, and marks the loan `Cancelled`. No fee is charged. Emits `loan_cancelled`.

Errors: `LoanNotFound`, `LoanNotRequested`, `InvalidState`, `StoreNotRegistered`.

### `fund_loan(investor, loan_id)`

Signer: `investor`.

Only valid while the loan is `Requested`. The investor must be a third party: it cannot be the loan’s weaver or the loan’s store.

Effects:
- sets `investor`, `funded_at`, and `end_at = funded_at + months × month_seconds`
- loan status `Funded`, rug status `Locked`
- rechecks `Store.open_principal <= Store.limit`
- pulls exactly `principal` USDC from the investor
- pays `weaver_payout` to the weaver, `store_fee` to the store, and `platform_fee` to `fee_recipient`
- retains `interest` in the contract until settlement

Emits `loan_funded` with the exact split and `end_at`.

Errors: `LoanNotFound`, `InvestorIsParty`, `LoanNotRequested`, `InvalidState`, `StoreNotRegistered`, `StoreLimitExceeded`, `InvalidAmount`.

### `repay(loan_id)`

Signer: `Loan.weaver`.

Only valid while the loan is `Funded`. Repayment is allowed at any time before `store_buyout` or `claim_rug`, including after `end_at` and throughout the buy-out window.

Effects:
- pulls exactly `principal` USDC from the weaver
- pays `principal + interest` to the investor with `try_transfer`; if that transfer fails, the full amount is recorded as investor credit and `investor_credited` is emitted
- returns the rug to `Free`; owner remains the weaver
- releases the store's principal reservation
- loan status `Repaid`

Emits `loan_repaid`, plus `investor_credited` when the investor payout could not be delivered.

Errors: `LoanNotFound`, `LoanNotFunded`, `LoanSettled`, `InvalidState`, `StoreNotRegistered`, `InvalidAmount`.

### `store_buyout(loan_id)`

Signer: `Loan.store`.

Allowed only in the half-open window:

```text
end_at <= now < end_at + buyout_window_seconds
```

Before `end_at` returns `TooEarly`; at or after `end_at + buyout_window_seconds` returns `BuyoutWindowClosed`. The store may buy out even if its `frozen` flag is set.

Effects:
- pulls exactly `principal` USDC from the store
- pays `principal + interest` to the investor with `try_transfer`; if that transfer fails, the full amount is recorded as investor credit and `investor_credited` is emitted
- transfers rug ownership to the store, rug status `Free`
- releases the store's principal reservation
- loan status `BoughtOut`

Emits `store_bought_out`, plus `investor_credited` when the investor payout could not be delivered. The store and platform fees were already paid at funding and are not refunded.

Errors: `LoanNotFound`, `LoanNotFunded`, `LoanSettled`, `TooEarly`, `BuyoutWindowClosed`, `InvalidState`, `StoreNotRegistered`, `InvalidAmount`.

### `claim_rug(loan_id)`

Signer: `Loan.investor`.

Allowed only when:

```text
now >= end_at + buyout_window_seconds
```

Before that returns `BuyoutWindowOpen`. The two windows are half-open and never overlap: the store can buy out up to but not including the window end; the investor can claim from the window end onward.

Effects:
- pays the held `interest` to the investor with `try_transfer`; if that transfer fails, the interest is recorded as investor credit and `investor_credited` is emitted
- transfers rug ownership to the investor, rug status `Free`
- freezes the store
- releases the store's principal reservation
- loan status `Claimed`

Emits `rug_claimed`, `store_frozen` with reason `MissedBuyout`, and `investor_credited` when the interest could not be delivered.

Errors: `LoanNotFound`, `LoanNotFunded`, `LoanSettled`, `BuyoutWindowOpen`, `InvalidState`, `StoreNotRegistered`, `InvalidAmount`.

### `redeem(holder, rug_id)`

Signers: `holder` and `Rug.store`. When `holder == Rug.store`, one store signature satisfies both roles; otherwise both must sign.

Only valid when `Rug.owner == holder` and `Rug.status == Free`. Marks the rug `Redeemed` (destroyed); it can never be requested or redeemed again. No USDC moves. This is allowed even when the store is frozen, so a store that missed a buy-out can still hand over a rug.

Emits `rug_redeemed`.

Errors: `RugNotFound`, `NotRugOwner`, `RugNotFree`.

### `withdraw_credit(investor) -> i128`

Signer: `investor`.

Transfers the whole recorded credit to the investor, sets the credit to 0, emits `credit_withdrawn`, and returns the amount. If the token transfer fails (for example, the investor still cannot receive USDC), the call fails and the credit remains available.

Errors: `NothingToWithdraw` when the credit is 0. USDC transfer failures surface as token/host errors and leave the credit unchanged.

### `get_credit(address) -> i128`

View, no auth. Returns the address's recorded credit, or 0 if none. Credit is held by the contract as USDC until withdrawn.

### Views

Views require no auth.

- `get_config() -> Config`
- `get_store(store: Address) -> Store` — `StoreNotRegistered` if missing
- `get_rug(rug_id: u64) -> Rug` — `RugNotFound` if missing
- `get_loan(loan_id: u64) -> Loan` - `LoanNotFound` if missing
- `get_credit(address: Address) -> i128` - 0 if no credit
- `next_rug_id() -> u64` - the id that the next `mint_rug` will use
- `next_loan_id() -> u64` — the id that the next `request_loan` will use
- `quote(principal: i128, months: u32) -> Quote` — pure fee calculation using the stored config; `InvalidAmount` or `InvalidMonths`
- `is_overdue(loan_id: u64) -> bool` — true only while the loan is `Funded` and `now >= end_at`; overdue is derived, never stored; `LoanNotFound` if missing

Auth failures from `require_auth` are Soroban host errors (for example `Error(Auth, InvalidAction)`), not contract error codes. A call with the wrong signer fails before the contract can return one of the errors above.

## Settlement windows

- `store_buyout` is allowed on the half-open interval `[end_at, end_at + buyout_window_seconds)`.
- `claim_rug` is allowed on `[end_at + buyout_window_seconds, ∞)`.
- `repay` is allowed from funding until either of those settlements runs.
- The two windows never overlap: at exactly `end_at` the store can buy out; at exactly `end_at + buyout_window_seconds` only the investor can claim.
- There is no `mark_unpaid`; overdue is derived from ledger time via `is_overdue`.

## Storage types

### `Config` (instance)

```text
admin: Address
usdc: Address
fee_recipient: Address
interest_bps_per_year: u32
platform_fee_bps: u32
store_fee_bps_per_month: u32
max_months: u32
month_seconds: u64
buyout_window_seconds: u64
```

### `Store` (persistent, keyed by store address)

```text
address: Address
limit: i128                 // max outstanding principal, USDC base units
open_principal: i128        // requested + funded, not yet cancelled/repaid/bought out/claimed
frozen: bool
```

### `Rug` (persistent, keyed by rug id)

```text
id: u64
store: Address
description: String
price: i128
owner: Address
status: Free | Requested | Locked | Redeemed
```

### `Loan` (persistent, keyed by loan id)

```text
id: u64
rug_id: u64
store: Address
weaver: Address
investor: Option<Address>
principal: i128
months: u32
interest: i128
platform_fee: i128
store_fee: i128
weaver_payout: i128
requested_at: u64
funded_at: Option<u64>
end_at: Option<u64>
status: Requested | Funded | Cancelled | Repaid | BoughtOut | Claimed
```

### `Quote`

```text
principal: i128
months: u32
interest: i128
platform_fee: i128
store_fee: i128
weaver_payout: i128
investor_payout: i128
```

### `Credit` (persistent, keyed by investor address)

```text
Credit(Address) -> i128
```

A claim on USDC held by the contract. It is created only when an investor payout cannot be delivered during `repay`, `store_buyout`, or `claim_rug`. `withdraw_credit` clears it to 0.

### Storage keys

```text
instance:    Config, NextRugId, NextLoanId
persistent:  Store(Address), Rug(u64), Loan(u64), Credit(Address)
```

Persistent entries and instance storage are bumped with a 100,000-ledger threshold and 200,000-ledger extension on access/save.

## Events

Events use the Soroban `#[contractevent]` macro, so their types are part of the contract spec. The first topic is the snake_case event name; fields marked “topic” follow it. Data is a map keyed by field name.

| Event | Topics | Data fields | Emitted by |
|---|---|---|---|
| `store_registered` | `store` | `limit` | `register_store` |
| `store_limit_set` | `store` | `limit` | `set_store_limit` |
| `store_frozen` | `store` | `reason` (`Platform` or `MissedBuyout`) | `freeze_store`; `claim_rug` |
| `rug_minted` | `rug_id` | `store`, `weaver`, `description`, `price` | `mint_rug` |
| `loan_requested` | `loan_id` | `rug_id`, `store`, `weaver`, `principal`, `months` | `request_loan` |
| `loan_cancelled` | `loan_id` | `rug_id`, `weaver` | `cancel_request` |
| `loan_funded` | `loan_id` | `rug_id`, `investor`, `principal`, `interest`, `platform_fee`, `store_fee`, `weaver_payout`, `end_at` | `fund_loan` |
| `loan_repaid` | `loan_id` | `rug_id`, `weaver`, `investor`, `principal`, `interest` | `repay` |
| `store_bought_out` | `loan_id` | `rug_id`, `store`, `investor`, `principal`, `interest` | `store_buyout` |
| `rug_claimed` | `loan_id` | `rug_id`, `investor`, `store`, `interest` | `claim_rug` |
| `investor_credited` | `investor` | `loan_id`, `amount` | `repay`, `store_buyout`, `claim_rug` when the investor payout fails |
| `credit_withdrawn` | `investor` | `amount` | `withdraw_credit` |
| `rug_redeemed` | `rug_id` | `store`, `holder` | `redeem` |

## Errors

| Code | Name | Meaning |
|---:|---|---|
| 1 | `InvalidConfig` | Constructor parameter invalid, or USDC is not 7 decimals. |
| 2 | `StoreAlreadyRegistered` | `register_store` called for an existing store. |
| 3 | `StoreNotRegistered` | Store does not exist. |
| 4 | `StoreFrozen` | `mint_rug` called for a frozen store. |
| 5 | `InvalidLimit` | Negative store limit. |
| 6 | `InvalidPrice` | Rug price is zero or negative. |
| 7 | `InvalidMonths` | Loan length is zero, above `max_months`, or above 12. |
| 8 | `InvalidDescription` | Description is empty or longer than 280 bytes. |
| 9 | `InvalidAmount` | Amount is non-positive or arithmetic overflowed. |
| 10 | `RugNotFound` | No rug with that id. |
| 11 | `RugNotFree` | Rug is `Requested`, `Locked`, or `Redeemed`. |
| 12 | `NotRugOwner` | Caller is not the rug owner. |
| 13 | `StoreLimitExceeded` | Request or funding would exceed the store’s principal limit. |
| 14 | `LoanNotFound` | No loan with that id. |
| 15 | `LoanNotRequested` | Action needs a loan in `Requested` state. |
| 16 | `LoanNotFunded` | Action needs a loan in `Funded` state, but it is `Requested` or `Cancelled`. |
| 17 | `LoanSettled` | Loan was already settled (`Repaid`, `BoughtOut`, or `Claimed`). |
| 18 | `TooEarly` | `store_buyout` called before `end_at`. |
| 19 | `BuyoutWindowClosed` | `store_buyout` called at or after `end_at + buyout_window_seconds`. |
| 20 | `BuyoutWindowOpen` | `claim_rug` called before `end_at + buyout_window_seconds`. |
| 21 | `InvalidState` | Internal state invariant failed (for example, a rug/loan status mismatch). |
| 22 | `WeaverIsStore` | `mint_rug` was asked to give the certificate to a registered store. |
| 23 | `StoreCannotBorrow` | `request_loan` was called by a registered store. |
| 24 | `InvestorIsParty` | `fund_loan` was called by the loan's weaver or the loan's store. |
| 25 | `NothingToWithdraw` | `withdraw_credit` was called when the investor has no credit. |

## Guarantees covered by tests

Milestone 1:
- Worked example reproduces exactly: 45 / 6 / 9 / 540 / 645.
- Fee components round down and sum with the weaver payout to exactly the principal.
- All Money Rules values come from constructor parameters.
- Store cap is a USDC principal cap, not a loan count; it is reserved at request and released on cancel/repay.
- Freeze blocks mint only.
- One open loan per rug.
- Request principal equals the rug price; months are whole and bounded.
- Funding pays the exact split and retains only the investor’s interest.
- Repayment returns the rug and pays the investor `principal + interest`; it is allowed after `end_at`.
- Redeem requires both holder and store auth, only works on a free rug, and is terminal.
- No per-rug Stellar asset or trustline is used.

Milestone 2:
- `store_buyout` is tested at `end_at - 1`, `end_at`, `end_at + window - 1`, and `end_at + window`.
- `claim_rug` is tested at the same four boundaries.
- The buy-out/claim windows are half-open and never overlap.
- `store_buyout` pays the investor `principal + interest`, gives the rug to the store, and releases principal.
- `claim_rug` pays the investor the held interest, gives the rug to the investor, freezes the store, emits `store_frozen` with `MissedBuyout`, and releases principal.
- `repay` remains available through the buy-out window and is rejected with `LoanSettled` after a buy-out or claim.
- A store may buy out while frozen; a frozen store can still redeem a rug.

Role-safety checks:
- `mint_rug` rejects the minting store or any other registered store as the weaver.
- `request_loan` rejects a registered store as the borrower, whether it bought the rug out or claimed another store’s rug.
- `fund_loan` rejects the loan’s weaver and the loan’s store as the investor; a different store and the admin can fund.
- Refused role checks leave store principal, rug status, loan state and USDC balances unchanged.
- A store holding a rug it bought out can redeem it with its own signature alone.

Investor credit fallback:
- `repay`, `store_buyout` and `claim_rug` complete even when the investor’s USDC transfer fails (for example, a deauthorized trustline).
- The undelivered amount is recorded exactly as `Credit(investor)`, the loan reaches its closed status, and the rug/store state moves as normal.
- The contract’s USDC balance always covers outstanding credit; total USDC is conserved to the stroop.
- `withdraw_credit` pays the credit once, zeroes it, and a second call returns `NothingToWithdraw`.
- Normal settlements where the investor can receive record no credit and preserve the existing balance expectations.

## Testnet deployment

Deployed and exercised on Stellar Testnet on 2026-11-12.

| Item | Value |
|---|---|
| Network | `testnet` |
| Contract ID | `CCX3Z3DJ7KS6YCSWQCIOJWFZCB76A7SD7LJI6BHDILO5FGSI6ZJJ4M2J` |
| Deploy ledger | `5,698,981` |
| Deploy transaction | `c7d13f5a55bf572e2afe933ce2f6254e7edf988b610917b7d0acad45ed08bc71` |
| USDC SAC address | `CCKKWM4ROXHPJAALYDXWL676MUB6OKGSWAZUOTB5SJIBWQ3B5ZDQZ3OM` |
| USDC classic asset | `USDC:GAWNPX6FZB7B7TZP6WC2H6L7AOYRXPBRDBWPISSAIFQPZX7GAQO3TWRY` |
| USDC issuer | `GAWNPX6FZB7B7TZP6WC2H6L7AOYRXPBRDBWPISSAIFQPZX7GAQO3TWRY` |
| Platform admin + fee recipient | `GCXRZRWAXQ2HDXIUAC5BZRZOLMD3RGLU42K64VHWCQV57CGXJWQTVCIZ` |
| Main demo store | `GBWCNPACZXNZKJKB7NA2EHRCZTNWT3LQBEHTYPTVF5X6VZNU5RXPPLCN` |
| Claim-demo store (frozen after the claim scenario) | `GDWBZD65XOYVVDMQHOST5SEQH4ZBXZTADY3NJIOGMYSYYVGK5RAFZ5RQ` |
| Demo weaver | `GBH4TKU2HPW7PGY5BCDU73E3PMZUK7TQ7RVDHP5QDTK23BHKW2XDGOQF` |
| Demo investor | `GCVBINDMVFUMQ3OBUVQGE6RFBWWBHSRKSLEQVZ6I7XQNQR2424HQOA2W` |

Deployment parameters:

```text
interest_bps_per_year:     1500
platform_fee_bps:          100 (once)
store_fee_bps_per_month:   25
max_months:                12
month_seconds:             60
buyout_window_seconds:     60
store limit (each store):  5000.0000000 USDC
demo rug price:            600.0000000 USDC
```

The main store is still active. `store2` was frozen by the claim scenario, as designed. The 60-second month means the buy-out window opens 60 seconds after funding and the claim window opens 60 seconds after that.

Public deployment data:

- `docs/testnet-deployment.json` — contract, USDC, public keys, parameters, transaction hashes
- `docs/testnet-demo-results.json` — exact balance deltas and final loan/rug state for the repay, buy-out, and claim scenarios
- `docs/testnet-demo.md` — deployment/demo runbook, script commands, and the current public testnet addresses
- `https://stellar.expert/explorer/testnet/contract/CCX3Z3DJ7KS6YCSWQCIOJWFZCB76A7SD7LJI6BHDILO5FGSI6ZJJ4M2J`

Secret keys are **not** in this repository. The demo identities live in the Stellar CLI config directory `~/.rugdealer-demo/config` (created by `scripts/testnet.py`). Only public keys are recorded here.


## Demo-readiness additions (local fix branch, not yet deployed)

- `store_count() -> u32`: number of registered stores, including frozen stores.
- `store_at(index: u32) -> Address`: zero-based durable discovery. Returns `StoreNotRegistered` for an absent index. Entries live in persistent storage, one address per index; clients read pages/concurrent small batches. `get_store(address)` remains the authority for limits and status. These views require a fresh deployment; old manifests must not advertise `features.store_index`.
- Constructor rejects a maximum term plus buy-out window that cannot fit `u64`. Funding checks `ledger timestamp + duration + window` before taking money, and returns `InvalidAmount` without changing Requested state if it overflows.
- Frontend payout reporting treats loan closure, credit creation and credit withdrawal separately. Credit is aggregated per investor; a `credit_withdrawn` event empties their entire credit. A rug timeline may therefore show an aggregate withdrawal that includes other loans. Missing event history is reported as unverified delivery, never as receipt of money.
- A hand-over release message names the immutable submitted rug, holder and confirmed hash, and requires a fresh read of that same Redeemed certificate. Editing the pasted code cannot change the confirmed release instruction.
