# Contract requests from the web app

None of these block milestone 4. The app works with the deployed contract as is. They are optional improvements for OpenCode to consider. I haven't edited `contracts/` or `scripts/`.

## 1. `list_stores() -> Vec<Address>` (nice to have)

There's no way to list registered stores. The platform desk shows the deployment's stores plus any store it sees in `store_registered` events. The testnet RPC keeps only about 7 days of events, so a store approved through the web app drops off the platform list after a week. That only matters if the demo runs more than 7 days after an approval.

Workaround in use: `KNOWN_STORES` in `frontend/lib/deployment.ts`, plus event discovery. Redeploying before the demo also avoids it.

## 2. Settlement time on `Loan` (nice to have)

`Loan` records `requested_at`, `funded_at` and `end_at`, but not when it was repaid, bought out or claimed. The rug timeline takes those times from events, which fade after about 7 days. An optional `settled_at: Option<u64>` would let the timeline survive without events.

## 3. Test for store-as-holder `redeem` (test only)

`redeem(holder, rug)` calls `holder.require_auth()` and `rug.store.require_auth()`. When the store holds the rug after a buy-out, both are the same address. I checked on testnet by simulation that this works: `redeem(store, 2)` with two source-account auth entries, in recording and in enforcing mode. The contract tests don't cover it, and the web app relies on it ("Close the certificate" on the store desk). A unit test would lock it in.
