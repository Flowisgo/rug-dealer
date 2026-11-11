# First loan: local successful sale

> Historical API for PR #3 and its original deployment. On `codex/full-loan-demo`, use [the extended API](full-demo-api.md) and [demo instructions](full-demo.md).

This slice implements a Soroban contract and local host tests. It does not include a frontend, wallet integration, testnet deployment, default handling, separate repayment, or physical pickup confirmation.

## Run locally

Install a current stable Rust toolchain with Cargo, then run from the repository root:

```sh
cargo test --workspace --locked
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
```

The workspace pins Soroban SDK 29.0.1 and commits its dependency lockfile. Tests invoke the contract through the generated client in the local Soroban host and use a real local Stellar Asset Contract for transfers. Authorization is simulated at the signing boundary; separate tests disable simulated signatures and verify rejection. No network or real funds are used by the tests (Cargo needs internet on the first dependency download).

## Fixed demo terms

The deployment fixes one warehouse and one seven-decimal test token. A deployment's constructor receives `(warehouse: Address, token: Address)`; it rejects tokens with other decimal counts. There is no upgrade or configuration-changing entry point.

| Amount | Test tokens | Smallest units (`i128`) |
| --- | ---: | ---: |
| Lender advance to weaver | 8 | 80000000 |
| Lender repayment at settlement | 9 | 90000000 |
| Fixed warehouse custody fee | 1 | 10000000 |
| Weaver-approved example sale price | 15 | 150000000 |
| Weaver surplus from that sale | 5 | 50000000 |

The weaver's total ending balance is 13 tokens when starting from zero: the earlier 8-token advance plus the 5-token sale surplus. The custody fee is paid at settlement and is not deducted from the advance.

## Frontend contract calls

Addresses are Stellar addresses, receipt IDs are `BytesN<32>`, and amounts are integer token units, never floating-point numbers. Generate the receipt ID once for the physical rug and preserve it across calls. The configured warehouse is trusted to identify each physical rug uniquely; a contract cannot detect the same rug presented under two different IDs or in another deployment.

| Call | Required signer | Result / effect |
| --- | --- | --- |
| `loan_terms()` | None | Read the immutable `advance`, `lender_due`, and `custody_fee` before asking the weaver to accept. |
| `register_receipt(id, weaver)` | Configured warehouse | Attest physical custody and create a receipt in `Held`. A receipt ID cannot be registered twice. |
| `accept_terms(id, lender)` | Receipt's weaver | Accept the fixed 8/9/1 terms and nominate the lender; move to `TermsAccepted`. |
| `fund_loan(id)` | Nominated lender | Transfer 8 tokens from lender to weaver; move to `Active`. |
| `approve_sale(id, price)` | Receipt's weaver | Set the sale price on an active loan. For this demo use `150000000`; a price below repayment plus custody fee is rejected. |
| `buy(id, buyer, payment)` | Buyer | Pay exactly the approved price, distribute the proceeds, record the buyer's wallet address, and move to `Settled` with `ready_for_pickup = true`. For this demo use `150000000`. |
| `get_receipt(id)` | None | Read `weaver`, nominated `lender`, `buyer`, `approved_price`, `stage`, and `ready_for_pickup`. |

`Receipt.buyer` is an `Option<Address>`: it starts as `None` and becomes `Some(buyer)` only after all three payouts succeed. The warehouse can read the settled buyer's wallet address through `get_receipt(id)`. A failed settlement leaves `buyer = None` and `ready_for_pickup = false`; a later successful retry records that successful buyer. A repeat purchase cannot replace the settled buyer.

The signing request for `accept_terms` binds the receipt and nominated lender to this contract's immutable terms. The frontend must display `loan_terms()` before requesting that signature. The lender and buyer also authorize their nested token transfers; wallet integration must retain those Soroban authorization entries when preparing transactions. No separate token allowance is required.

## Settlement and rejection behavior

`Held → TermsAccepted → Active → Settled`

`buy` first checks the active loan and exact approved price. It transfers the buyer's payment into the contract, then pays 9 to the lender, 1 to the warehouse, and the remainder (5 in the example) to the weaver. It records the buyer's wallet address and pickup clearance only after all transfers return successfully. Token failures abort the call, so Soroban rolls back the payment, earlier payouts, and state together.

Underpayment and overpayment are rejected before any transfer. Funding without accepted terms, repeat funding, replacing an active loan's lender, and buying twice are rejected. A settled receipt cannot be reused for another loan in this slice. Failed settlement leaves the receipt active and can be retried once the token failure is resolved.

Business errors are `ReceiptExists (1)`, `ReceiptMissing (2)`, `WrongStage (3)`, `PriceNotApproved (4)`, and `InvalidPrice (5)`. Missing authorization and token failures surface as host/token invocation errors. The frontend should refresh `get_receipt` after confirmed settlement before showing pickup clearance.

The local tests cover the exact advance and three payouts, recording the correct buyer, underpayment even when stray tokens sit in the contract, duplicate active loans, missing signatures and expected signers, sale prerequisites, repeat settlement, readable terms, and rollback when the weaver's final payout fails. The rollback test freezes the weaver using the token issuer's authorization controls, verifies that the buyer remains unset and pickup locked, then verifies a successful retry after unfreezing. A repeat purchase by a different wallet cannot overwrite the settled buyer.

The warehouse's signature is an attestation, not proof observable by Stellar. Physical custody and handoff remain off-chain. This local prototype does not implement production storage-lifetime maintenance or archival restoration workflows; these must be addressed before a live deployment.
