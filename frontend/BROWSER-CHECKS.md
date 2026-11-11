# Browser verification

Verified against the production build (`npm run build` followed by `npm start`) on 2026-11-10, using the actual deployed contract and live Stellar testnet RPC. No wallet or contract responses were mocked.

## Passed in the in-app browser

- Before the Varial purchase, the fresh receipt `a7fda59407b719206fc2afa87afb91069f2370b9629aabcb78e1a5948e9de703` loaded with an approved price of **15 test USDC**, stage **Active**, no recorded buyer, and pickup **Locked · awaiting settlement**. That same receipt is now settled, as verified below.
- The live `loan_terms` values produce the **9 / 1 / 5** payout breakdown.
- “Refresh status” reads the receipt again from testnet.
- “Connect Freighter” in a browser without Freighter returns an actionable wallet-unavailable message and installation link; it does not attempt a purchase.
- The previously settled receipt `8dbbb3cf37a2416032cc4cf6a4be11163bf0042509cc24ea9bbf25b119b23337` shows **Settled**, the recorded buyer `GCNRJ2OUZ4UOAV46LYC4I2QO3CLU4BMBUNA4QXA5UOG7MHK3JFPDDGZS`, and **Ready for pickup**. Its purchase button is absent.
- Submitting `not-a-receipt` in the receipt loader shows the 64-character validation error without changing the receipt or submitting a transaction.

## Checks

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Successful Varial purchase

The user completed the buyer-page purchase using Varial on Stellar testnet. The supplied transaction was independently verified through Horizon, including its `buy` invocation, receipt ID, payment amount, and all four USDC transfers. A subsequent `get_receipt` read verified the settled state and recorded buyer.

- [Confirmed purchase transaction](https://stellar.expert/explorer/testnet/tx/b87174f435d428a6b9911deb12eafe1fb3361e9c578f8645d15377a0ba558fba): `b87174f435d428a6b9911deb12eafe1fb3361e9c578f8645d15377a0ba558fba`.
- Result: **successful**, ledger **5666446**.
- Confirmed at **2026-11-10 19:11:13 America/Toronto** (`2026-11-11T00:11:13Z`).
- Contract: `CCRIC7GAMNO3MADK5VIDG7PB7XCJBGMJDC2PNPCMBC5CW6SJU66T6YEF`.
- Receipt: `a7fda59407b719206fc2afa87afb91069f2370b9629aabcb78e1a5948e9de703`.
- Buyer and transaction source: `GDXBJBPK3LCGTYSRBGWZ2M33PMYZKIMZM74QRV3QINOK76XFLRSDOEEQ`.
- Approved price and purchase payment: **15 test USDC** (`150000000` smallest units).
- Asset: Circle testnet USDC, issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.

### Verified payouts

The successful transaction records 15 USDC transferred from the buyer to the contract, followed by these three payouts. These figures are changes from this sale, not the parties' total balances.

| Party | Wallet | USDC change in this sale |
| --- | --- | ---: |
| Buyer | `GDXBJBPK3LCGTYSRBGWZ2M33PMYZKIMZM74QRV3QINOK76XFLRSDOEEQ` | **−15** |
| Lender | `GADYJDZI3EH4YP5QYHRVGWQC444S6Q2WKFT23LPTXFHZHW4GFKP3DR3G` | **+9** |
| Warehouse | `GALBTMOQLGDYANDGXIHXGZHLALE3C3BYO43C3NYORGWRR34PL44465DQ` | **+1** |
| Weaver | `GBXT6F6GJHLFL2LL72K7EZLCSFKLYJ7TLAIXCOGICVMSHOIKKWZOIIVA` | **+5** |

The contract's net USDC change from settlement is **0**. Test XLM network fees are separate.

### Verified final receipt

Reading `get_receipt` from the deployed contract after confirmation returned:

```json
{
  "approved_price": "150000000",
  "buyer": "GDXBJBPK3LCGTYSRBGWZ2M33PMYZKIMZM74QRV3QINOK76XFLRSDOEEQ",
  "lender": "GADYJDZI3EH4YP5QYHRVGWQC444S6Q2WKFT23LPTXFHZHW4GFKP3DR3G",
  "ready_for_pickup": true,
  "stage": "Settled",
  "weaver": "GBXT6F6GJHLFL2LL72K7EZLCSFKLYJ7TLAIXCOGICVMSHOIKKWZOIIVA"
}
```

The receipt records the actual Varial buyer and clears the rug for pickup. The default fixture is now consumed; another purchase test requires a newly registered, funded, and sale-approved receipt.

### Verification boundary

Wallet interaction was performed by the user in Varial; transaction success, exact payouts, and the final receipt were independently checked on-chain. This purchase is separate from the earlier CLI settlement for PR #3. The transient pending/confirmation UI and transaction-link persistence after reload were not independently rechecked during this report update.
