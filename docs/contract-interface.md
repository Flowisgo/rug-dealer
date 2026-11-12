# RugDealer contract interface

Status: **milestone 2 (buy-out path)**. Testnet IDs are added in milestone 3.

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

### `register_store(store, limit)`

Signer: `admin`.

Creates a store with a USDC principal limit. `limit` is the maximum outstanding principal in USDC base units. Fails with `StoreAlreadyRegistered` if the store already exists. Use `set_store_limit` to change it. Emits `store_registered`.

### `set_store_limit(store, limit)`

Signer: `admin`.

Updates an existing store’s principal limit. The limit may be lowered below current `open_principal`; existing loans are unaffected, but new requests and unfunded requests are refused until `open_principal <= limit`. Emits `store_limit_set`.

### `freeze_store(store)`

Signer: `admin`.

Sets `Store.frozen = true`. Freeze blocks **only `mint_rug`**. It does not block `request_loan` or `fund_loan`. Emits `store_frozen` with reason `Platform` on the first freeze. Idempotent.

### `mint_rug(store, weaver, description, price) -> rug_id`

Signer: `store`.

Creates an in-contract rug certificate owned by `weaver` with the given description and USDC price. The contract assigns `rug_id` from `NextRugId`. No Stellar asset, SAC, or trustline is created.

Requirements:
- store is registered and not frozen
- `price > 0`
- description length is 1–280 bytes

Emits `rug_minted`.

### `request_loan(weaver, rug_id, months) -> loan_id`

Signer: `weaver`.

Creates a loan request for exactly `Rug.price` over `months` whole months (`1..=max_months`).

Requirements:
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

### `cancel_request(loan_id)`

Signer: `Loan.weaver`.

Only valid while the loan is `Requested` (not funded). Returns the rug to `Free`, clears the store’s reserved principal, and marks the loan `Cancelled`. No fee is charged. Emits `loan_cancelled`.

### `fund_loan(investor, loan_id)`

Signer: `investor`.

Only valid while the loan is `Requested`.

Effects:
- sets `investor`, `funded_at`, and `end_at = funded_at + months × month_seconds`
- loan status `Funded`, rug status `Locked`
- rechecks `Store.open_principal <= Store.limit`
- pulls exactly `principal` USDC from the investor
- pays `weaver_payout` to the weaver, `store_fee` to the store, and `platform_fee` to `fee_recipient`
- retains `interest` in the contract until settlement

Emits `loan_funded` with the exact split and `end_at`.

### `repay(loan_id)`

Signer: `Loan.weaver`.

Only valid while the loan is `Funded`. Repayment is allowed at any time before `store_buyout` or `claim_rug`, including after `end_at` and throughout the buy-out window.

Effects:
- pulls exactly `principal` USDC from the weaver
- pays `principal + interest` to the investor
- returns the rug to `Free`; owner remains the weaver
- releases the store’s principal reservation
- loan status `Repaid`

Emits `loan_repaid`.

### `store_buyout(loan_id)`

Signer: `Loan.store`.

Allowed only in the half-open window:

```text
end_at <= now < end_at + buyout_window_seconds
```

Before `end_at` returns `TooEarly`; at or after `end_at + buyout_window_seconds` returns `BuyoutWindowClosed`. The store may buy out even if its `frozen` flag is set.

Effects:
- pulls exactly `principal` USDC from the store
- pays `principal + interest` to the investor
- transfers rug ownership to the store, rug status `Free`
- releases the store’s principal reservation
- loan status `BoughtOut`

Emits `store_bought_out`. The store and platform fees were already paid at funding and are not refunded.

### `claim_rug(loan_id)`

Signer: `Loan.investor`.

Allowed only when:

```text
now >= end_at + buyout_window_seconds
```

Before that returns `BuyoutWindowOpen`. The two windows are half-open and never overlap: the store can buy out up to but not including the window end; the investor can claim from the window end onward.

Effects:
- pays the held `interest` to the investor; principal is not returned
- transfers rug ownership to the investor, rug status `Free`
- freezes the store
- releases the store’s principal reservation
- loan status `Claimed`

Emits `rug_claimed` and emits `store_frozen` with reason `MissedBuyout` to flag the missed buy-out.

### `redeem(holder, rug_id)`

Signers: `holder` and `Rug.store`.

Only valid when `Rug.owner == holder` and `Rug.status == Free`. Marks the rug `Redeemed` (destroyed); it can never be requested or redeemed again. No USDC moves. This is allowed even when the store is frozen, so a store that missed a buy-out can still hand over a rug.

Emits `rug_redeemed`.

### Views

- `get_config() -> Config`
- `get_store(store: Address) -> Store`
- `get_rug(rug_id: u64) -> Rug`
- `get_loan(loan_id: u64) -> Loan`
- `next_rug_id() -> u64` — the id that the next `mint_rug` will use
- `next_loan_id() -> u64` — the id that the next `request_loan` will use
- `quote(principal: i128, months: u32) -> Quote` — pure fee calculation using the stored config
- `is_overdue(loan_id: u64) -> bool` — true only while the loan is `Funded` and `now >= end_at`; overdue is derived, never stored

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

### Storage keys

```text
instance:    Config, NextRugId, NextLoanId
persistent:  Store(Address), Rug(u64), Loan(u64)
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

## Testnet deployment

To be added in milestone 3:

```text
network:            testnet
contract id:        TBD
USDC SAC address:   TBD
admin public key:   TBD
fee recipient:      TBD
demo store key:     TBD
demo weaver key:    TBD
demo investor key:  TBD
```

Only public keys are recorded here. Secret keys stay outside the repository.
