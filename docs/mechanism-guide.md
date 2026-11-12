# Mechanism Guide for RugDealer v2

> **This is the current, authoritative version of the guide.** It replaces any earlier PDF or draft (older drafts said the platform fee was 0.25% per month, loans ran 3–12 months, and repayment ended at the end date; all three are superseded). The deployed contract implements this version. Where the guide was silent or ambiguous, the decisions in [Agreed decisions](#agreed-decisions) at the end apply. The contract's exact API is in [contract-interface.md](contract-interface.md).

RugDealer lets a rug weaver who needs money borrow against a finished rug instead of selling it. A rug store prices the rug at what it would normally pay to buy it, which is far below what a real buyer pays, then holds the rug and issues a token for it. An investor lends the weaver exactly that price through a Soroban contract. If the weaver repays in time, they get the rug back and can sell it to a real buyer whenever they find one. If not, the store buys the rug at that same price, and the investor is repaid from the purchase.

## Actors

| Actor | What they do | What they hold |
| --- | --- | --- |
| Weaver | Leaves a finished rug with a store and borrows the store's buying price. Repays to get the rug back, or the store buys it | The token, when no loan is open |
| Rug store | Prices the rug at its normal buying price, mints the token, stores the rug, and must buy the rug at that price if the loan isn't repaid | The physical rug |
| Investor | Funds one loan and gets the loan amount plus interest back, from the weaver or from the store | Nothing during the loan |
| Soroban contract | Locks the token, pays out the loan, holds the interest, collects the repayment or the store's purchase, pays the investor | The locked token, the loan money and the interest |
| Converter | A Stellar anchor that swaps USDC and local currency for the weaver, and runs the identity checks on the weaver | Nothing |
| Platform | Approves which stores can mint tokens, sets each store's limit, freezes a store that breaks the rules, takes the platform fee | Nothing. It cannot move tokens or money |

## The Asset

Each rug gets one unique token, minted by the store. It records the rug's description, the store's buying price in USDC, and which store holds it. The token is a claim on the rug: the store hands the rug to whoever redeems the token, and the token is then destroyed. The weaver owns the token outright. The contract locks it while a loan is open. It unlocks to the weaver on repayment, or passes to the store if the loan is not repaid. The rug stays in the store the whole time.

The price is the store's own offer to buy the rug, typically around 40% of what the rug fetches from a real buyer. Because the store must buy at this price if the loan isn't repaid, it has no reason to overstate it. Because the weaver can walk away and take the rug elsewhere, the store has a reason not to understate it.

## Loan Steps

1. **Drop-off.** The weaver brings a finished rug to a rug store.
2. **Price and mint.** The store offers its normal buying price. If the weaver accepts, the store mints the token at that price and gives it to the weaver.
3. **Loan request.** The weaver asks the contract for a loan of exactly the token's price and chooses how long it runs, up to 12 months. The contract locks the token. A token can back only one open loan at a time.
4. **Funding.** An investor funds the loan in USDC. The contract keeps the interest for the whole term, takes the platform fee and the store fee, and pays the rest out. The converter turns it into local currency for the weaver.
5. **Close.** The loan ends in one of two ways:
   - **Repay.** By the end date, the weaver pays back exactly the loan amount in one payment, in local currency. The converter turns it into USDC, which goes into the contract. The token unlocks, and the weaver redeems it to collect the rug, or keeps it to borrow again. The rug is theirs to sell to a real buyer whenever they find one.
   - **Store buys.** If the loan is still open on its end date, the store has 7 days to pay the loan amount into the contract, and the token passes to the store. The weaver can still repay until either buy-out or investor claim confirms.
6. **Payout.** Either way, the contract pays the investor the loan amount plus the interest it held.

Interest is for the full chosen term and is not refunded if the weaver repays early.

The production proposal uses a 30-day month and a 7-day buy-out window. **The deployed Testnet demo uses 60 seconds for each.** Timed actions follow closed-ledger time.

## Money Rules

| Rule | Value | Who it goes to |
| --- | --- | --- |
| Currency | USDC inside the contract, local currency for the weaver | |
| Loan amount | Exactly the store's buying price for the rug | Weaver |
| Loan length | Chosen by the weaver, up to 12 months. Repayable early at any time | |
| Interest | 15% a year on the loan amount, for the whole term, taken out of the loan up front | Investor, paid when the loan closes |
| Platform fee | 1% of the loan, taken once at payout | Platform |
| Store fee | 0.25% of the loan for each month of loan length, taken once at payout | Store, for holding the rug |
| Store buy-out | The loan amount, paid by the store if the loan is not repaid | Contract, then investor |
| Store limit | The total of open loans at one store may not exceed a cap set by the platform | |
| Conversion fee | Set by the anchor, planned at 2% each way | Converter |
| Network fees | Paid in XLM by each transaction signer; the prototype does not sponsor them | Stellar network |
| Funding | One investor funds one whole loan | |

## When Things Go Wrong

| What goes wrong | What happens |
| --- | --- |
| Nobody funds the loan request | The weaver can cancel at any time and the token unlocks. No fee. |
| The store doesn't pay the buy-out within 7 days of the end date | The store is frozen: it can't mint new tokens and is flagged to investors. The investor can take the token, and with it the rug, in place of repayment. The partner agreement recovers the rest. The weaver owes nothing more. |
| The store can't produce a rug, whether lost, damaged or not handed over | The store owes the token's price to whoever holds the token. Under a loan, it pays into the contract as if the loan had ended unpaid. After repayment, it pays the weaver directly. |
| A store closes | Unlocked tokens are redeemed for their rugs. For open loans the store owes the buy-out at once, and the rugs are released to it on payment. |
| The converter is slow or fails | The loan waits as USDC in the weaver's account. The contract is not affected. |
| The platform disappears | The contract keeps running. Loans can still be repaid, stores can still buy out, and tokens still unlock. |

## Worked Example

A rug that a real buyer would pay about $1,500 for. The store offers $600, its normal buying price. The weaver takes a 6-month loan of $600. Conversion fees are left out.

| | Amount |
| --- | --- |
| Investor funds | $600 |
| Interest held for the investor (15% a year for 6 months) | $45 |
| Platform fee | $6 |
| Store fee (0.25% for 6 months) | $9 |
| Weaver receives up front | $540 |

| How it ends | Weaver | Store | Investor |
| --- | --- | --- | --- |
| Weaver repays at month 6 | Pays $600, gets the rug back. Total cost $60 | Earned $9 | Receives or is credited $645 |
| No repayment by month 6 | Pays nothing more. Keeps the $540 | Pays $600, owns the rug | Receives or is credited $645 |

Claim after the missed buy-out instead gives the investor the rug plus $45 interest (or backed credit), without refunding the $600 principal. The store freezes.

## Formulas

- Loan = price recorded on the token
- Interest = loan × 0.15 × months ÷ 12
- Platform fee = 0.01 × loan. Store fee = 0.0025 × loan × months
- Weaver receives = loan − interest − platform fee − store fee
- Weaver repays = loan. Store buy-out = loan
- Repayment or buy-out: investor receives loan + interest, or the same amount as backed credit if delivery fails.
- Claim: investor owns the rug plus receives (or is credited) held interest; principal is not refunded.
- Loan closure does not guarantee wallet delivery. An investor withdraws held credit after restoring receipt capability.
- Open loans at a store ≤ that store's limit

---

# Build spec

## Contract state

- **Store:** address, approved or frozen, limit, total of open loans.
- **Rug token:** id, store, description, price, owner, status (free, locked, redeemed).
- **Loan:** id, token id, weaver, investor, amount, interest held, months, start, end date, status (requested, open, repaid, bought_out, claimed).

## Contract functions

| Function | Who can call | Effect |
| --- | --- | --- |
| `add_store(store, limit)`, `set_limit`, `freeze_store` | Platform | Approves a store, sets its cap, or stops it minting |
| `mint_rug(weaver, description, price)` | Approved store | Creates a token at that price, owned by the weaver |
| `request_loan(token, months)` | Token owner | Locks the token, opens a request for exactly the price; refused if months > 12, the token is already locked, or the store would exceed its limit |
| `cancel_request(loan)` | Weaver | Unlocks the token if not yet funded |
| `fund_loan(loan)` | Investor | Transfers the loan amount in; contract holds interest, pays platform fee, store fee and the remainder to the weaver; sets the end date |
| `repay(loan)` | Weaver | Accepts exactly the loan amount; pays investor loan + interest; unlocks the token. Allowed until buy-out or investor claim confirms |
| `store_buyout(loan)` | The rug's store | After the end date: accepts the loan amount, pays investor loan + interest, moves the token to the store |
| `claim_rug(loan)` | Investor | 7 days after the end date with no buy-out: pays investor the held interest, moves the token to the investor, flags the store |
| `redeem(token)` | Token owner + store | Store confirms hand-over; token destroyed |

Emit an event from every function for the web app's activity feed.

(The deployed contract's actual names and signatures differ slightly, e.g. `register_store` and `set_store_limit`; see [contract-interface.md](contract-interface.md).)

## Stellar pieces

- Rug tokens: one unique token per rug, issued through the contract (a Soroban NFT-style record is fine for the prototype).
- USDC: on Testnet, issue our own test USDC with a faucet; keep the token address configurable.
- Converter: mocked. The weaver's account simply receives test USDC. Show a "local currency" balance in the UI by applying a fixed rate.

## Guarantees to test after every change

- No money is created or lost: everything in equals everything out, to the smallest unit.
- The investor receives exactly loan + interest in every closing path (see agreed decision 2 for the claim path).
- A token never backs two open loans.
- Every loan reaches a closed state; none can get stuck.
- A store can never exceed its limit.
- The worked example reproduces exactly.

## Milestones

1. **Contract core:** scaffold; money math with unit tests; add_store, mint_rug, request_loan, fund_loan, repay, redeem on the happy path; a test reproducing the worked example. *(Done.)*
2. **Buy-out path:** store_buyout, claim_rug, cancel_request, freeze_store, store limit; authorization tests (only approved stores mint, only the token owner borrows, no buy-out before the end date, no claim before day 7). *(Done.)*
3. **Testnet and scripts:** setup script creating accounts, test USDC and a rug token, deploying the contract and printing contract IDs; demo script running one rug through repayment and a second through buy-out. *(Done.)*
4. **Web app:** wallet connection (Freighter), one view per role (store: mint and buy out; weaver: borrow, repay, redeem; investor: fund, see returns; platform: approve stores), mobile-friendly, deployed to a public URL. Hide blockchain terms in the main flow.
5. **Submission:** README (problem, how it works, who holds what, setup and run, contract IDs, live URL); 1-minute demo video of the working prototype.

## Out of scope

Real anchor integration, KYC flows, mainnet, multiple investors per loan, secondary trading of rug tokens, yield on idle funds, credit scores, an earned store limit, any sale through the contract.

---

# Agreed decisions

Settled while building milestones 1–3, where the guide was silent or ambiguous. The deployed contract implements all of them.

1. The v2 contract was built fresh from `main` at `contracts/rugdealer`. The `codex/*` branches are an older design.
2. `claim_rug` pays the investor the held interest plus the rug token. "Investor receives exactly loan + interest" applies to the repay and buy-out paths.
3. Rounding: interest, platform fee and store fee each round down. The remainder goes to the weaver, so funded amount = interest + platform fee + store fee + weaver payout exactly.
4. Every Money Rules number is a deployment parameter: `interest_bps_per_year` (1500), `platform_fee_bps` (100), `store_fee_bps_per_month` (25), `max_months` (12), `month_seconds` (30 days; the demo deployment uses 60 seconds), `buyout_window_seconds` (7 days; the demo uses 60 seconds), and a `fee_recipient` address.
5. Loan length is whole months, 1 to `max_months`.
6. The store limit is a USDC amount (`open_principal`), not a loan count. A loan counts from `request_loan` and is released on `cancel_request`, `repay`, `store_buyout` or `claim_rug`.
7. Fees are taken at `fund_loan`.
8. `repay` stays open after the end date and through the buy-out window, until `store_buyout` or `claim_rug` runs.
9. Windows are half-open: `store_buyout` when `end_at <= now < end_at + window`; `claim_rug` when `now >= end_at + window`.
10. Freezing blocks `mint_rug` only. `claim_rug` freezes the store automatically (reason `MissedBuyout`). There is no unfreeze.
11. Rug tokens are records inside the contract (no Stellar asset or trustline per rug). `redeem` needs the holder's and the store's signatures and only works on a free rug, even if the store is frozen.
12. "Store can't produce the rug" and "store closes" are handled by the off-chain partner agreement and are not in the prototype contract.
