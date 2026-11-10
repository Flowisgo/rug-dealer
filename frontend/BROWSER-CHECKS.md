# Browser verification

Verified against the production build (`npm run build` followed by `npm start`) on 2026-11-10, using the actual deployed contract and live Stellar testnet RPC. No wallet or contract responses were mocked.

## Passed in the in-app browser

- The fresh receipt `a7fda59407b719206fc2afa87afb91069f2370b9629aabcb78e1a5948e9de703` loads with an approved price of **15 test USDC**, stage **Active**, no recorded buyer, and pickup **Locked · awaiting settlement**.
- The live `loan_terms` values produce the **9 / 1 / 5** payout breakdown.
- “Refresh status” reads the receipt again from testnet.
- “Connect Freighter” in a browser without Freighter returns an actionable wallet-unavailable message and installation link; it does not attempt a purchase.
- The previously settled receipt `8dbbb3cf37a2416032cc4cf6a4be11163bf0042509cc24ea9bbf25b119b23337` shows **Settled**, the recorded buyer `GCNRJ2OUZ4UOAV46LYC4I2QO3CLU4BMBUNA4QXA5UOG7MHK3JFPDDGZS`, and **Ready for pickup**. Its purchase button is absent.
- Submitting `not-a-receipt` in the receipt loader shows the 64-character validation error without changing the receipt or submitting a transaction.

## Checks

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Remaining manual verification

**A Freighter-signed purchase has not been completed or verified in the browser.** The in-app browser cannot host Freighter. Chrome navigation could be driven through its native address bar, but Chrome's browser automation failed on DOM inspection and screenshots, so it could not reliably drive or verify the wallet prompts. The user confirmed that Freighter is not set up yet. Installing Freighter and creating or unlocking a Testnet wallet are required before the signing test can proceed. No wallet seed or private key was entered into the page, and the fresh receipt was left unpurchased for that test.

To finish:

1. Run the app and open http://127.0.0.1:3000 in Chrome with Freighter.
2. Connect the buyer wallet on Testnet. It needs a Circle testnet USDC trustline, at least **15 test USDC**, and test XLM for fees. The prepared CLI demo buyer has 15 test USDC, but those CLI keys are not automatically available to Freighter.
3. Review the on-chain price, click **Review & pay 15 test USDC**, and approve the transaction in Freighter.
4. Verify the page first shows pending, then a confirmed transaction link. After its receipt refresh, verify that the recorded buyer matches the signing wallet and pickup is **Ready for pickup**.
5. Reload and verify the receipt and transaction link persist and another purchase is unavailable. Record the transaction hash and before/after balances: buyer −15, lender +9, warehouse +1, weaver +5 test USDC.

This limitation is distinct from the CLI testnet settlement already completed for PR #3. The earlier CLI transaction is not evidence that Freighter signing or the frontend submission path has passed.
