# Frontend status (milestone 4)

Overnight run, 2026-11-12. Everything is in `frontend/`. Nothing pushed. No transactions were signed or sent, and no secret keys were read.

## What's done

| Piece | State |
|---|---|
| 4a: scaffold, config, read layer, landing, `/activity` | Done, verified against live testnet |
| 4b: transaction pipeline, wallet, error mapping, hand-over | Code done and typechecked. **Not exercised**: needs Freighter |
| 4c `/store` | UI done, read views verified on testnet |
| 4d `/weaver` | UI done, read views verified on testnet |
| 4e `/investor` | UI done, read views verified on testnet |
| 4f `/platform` | UI done, read views verified on testnet |
| 4g `/rug/[id]`, empty and error states | Done, verified (rug 1–3, missing rug 99, bad id `abc`) |
| Tests | 40 unit tests and 6 testnet smoke tests, all passing |
| Typecheck and build | `npm run typecheck` and `npm run build` both pass |

Commits on `main` (not pushed):

- `27c658b` feat(web): scaffold, read layer, landing and activity feed (4a)
- `82ef5e8` feat(web): store, weaver, investor, platform desks and rug timeline
- `7631670` test(web): money maths, event decoding, rules and a testnet smoke test
- plus a final docs commit with this file

### Commands (run in `frontend/`)

```bash
npm run dev        # http://localhost:3000
npm test           # unit tests (offline)
npm run smoke      # read-only checks against live testnet
npm run typecheck
npm run build
```

### Layout

- `lib/deployment.ts`: public deployment data (contract, USDC SAC, demo public keys, deploy ledger) and friendly demo names
- `lib/money.ts`: bigint ↔ 7 decimals, formatting, `TRY_PER_USDC = 45n`, local copy of the contract's fee maths
- `lib/contract.ts`: typed reads; every read is a simulation. Lists walk `1..next_rug_id` / `1..next_loan_id`
- `lib/events.ts`: `getEvents` (paged, from the deploy ledger or the RPC's oldest kept ledger) → typed events → sentences
- `lib/tx.ts`: build → simulate (restore archived data first if the simulation asks) → assemble → Freighter sign → hash check → send → poll. The pending hash goes into `localStorage`; on reload a banner says whether it went through
- `lib/wallet.ts`: Freighter connect, testnet check, `signTransaction`, `signAuthEntry`
- `lib/handover.ts`: two-signature `redeem` (see below)
- `lib/errors.ts`: contract errors 1–21 and USDC token errors in plain words
- `lib/rules.ts`: loan phase (running / buy-out window / claimable), labels, totals
- `components/`: shell (header, testnet strip, woven band, wallet chip), claim-ticket rug cards, action button with step messages and confirm dialog

### How the hand-over (redeem) works

1. The holder (weaver, or investor after a claim) presses **Collect the rug**. The app simulates `redeem(holder, rug)` with the **store as transaction source**, so the store authorises as the source account and only the holder's auth entry needs a separate signature. Freighter's `signAuthEntry` signs it, valid for about 24 hours (17,280 ledgers).
2. The app shows a link `/store?handover=<code>` and the bare code. The code is the rug id, holder, store, expiry and all auth entries, as base64url JSON. It's also kept in `localStorage`, so a reload doesn't lose it.
3. The store opens the link, or pastes the code into **Hand a rug over** on `/store`. The app rebuilds the call with those auth entries, simulates it in enforcing mode (which checks the holder's signature), and the store signs the envelope and submits.
4. **Store as holder** (after a buy-out): **Close the certificate** on `/store` needs one signature. I checked this by simulation on testnet: `redeem(store, 2)` succeeds with two source-account auth entries, and re-simulating with those entries in enforcing mode also succeeds. The contract tests don't cover this case.

### Read-only look-around mode (added)

Every desk accepts `?as=store|store2|weaver|investor|platform|G…` to show that account's screen read-only. Without a wallet, each desk offers "Look around as <demo account>". Action buttons stay disabled with a hint ("Connect Freighter as Kaya Rug House to do this"). I added it so I could verify every desk in a browser without Freighter. It also lets judges look around with no wallet. Remove it if you don't want it.

## Screenshots taken

Checked in the built-in browser at 1280px and 375px against live testnet. I also checked every route at 375px for horizontal overflow, and none had any. Saved in `frontend/screenshots/`:

- `landing-1280.jpg`: hero and worked-example claim ticket
- `activity-375.jpg`: activity feed on a phone (all 15 testnet events render)
- `weaver-1280.jpg`: Ayşe's desk with the month picker and the contract-checked fee breakdown
- `store2-frozen-1280.png`: Bazaar Corner Rugs with the "Frozen: missed buy-out" banner
- `platform-1280.png`: platform desk, both stores, freeze control

Screenshot capture in the pane was flaky at full frame, so I verified other views by page text: store, investor, rug timeline, the co-sign screen opened from a sample link, and the no-wallet states. The console showed no errors on a fresh tab.

## What you must test in Chrome with Freighter

Setup, once:

1. Install Freighter in Chrome and switch it to **Testnet**.
2. Import the demo accounts into Freighter. The secrets are in the Stellar CLI config at `~/.rugdealer-demo/config` (identities `rd-admin`, `rd-store`, `rd-store2`, `rd-weaver`, `rd-investor`). For example, `stellar --config-dir ~/.rugdealer-demo/config keys secret rd-weaver`, then use Freighter's "Import using secret key". I did not run this.
3. `cd frontend && npm run dev` and open `http://localhost:3000`. Connect Freighter and allow the site.

Do the flows in this order. Each step names the account Freighter must have selected.

**A. Happy path: issue, borrow, fund, repay, collect**

1. *rd-store* → `/store` → Issue a rug certificate: choose Ayşe, write a description, price `600`. Check the preview shows 585 / 540 / 486 for 1 / 6 / 12 months. Press **Issue rug certificate** and sign. Expect "Certificate issued", the rug in "This store's rugs", and a line in `/activity`.
2. *rd-weaver* → `/weaver`: the new rug shows "At the store, free to borrow". Pick **2** months. The breakdown should say "Figures checked with the contract". Press **Ask for 600.00 USDC** and sign. The tag becomes "Waiting for an investor".
3. (Optional) Press **Cancel the request** and sign, then borrow again. Cancel should leave the rug free with no fee.
4. *rd-investor* → `/investor`: the request is under Open requests (You lend 600, You earn 15, You get back 615). Press **Lend 600.00 USDC** and sign. The wallet chip balance drops by 600. The weaver receives 576.00 (600 − 15 interest − 6 platform − 3 store); `/activity` should say "The weaver received 576.00 USDC".
5. *rd-weaver* → `/weaver`: the tag reads "Held as security" with a "Due in" countdown of about 2:00. Press **Repay 600.00 USDC** and sign. The rug goes back to "At the store, free to borrow".
6. *rd-weaver*: **Collect the rug** → sign the auth entry in Freighter (a different Freighter prompt from a transaction) → **Copy link for the store**.
7. Switch to *rd-store* and open the copied link. The **Hand a rug over** panel shows "Ayşe the weaver wants to collect rug No. 000N". Press **Sign and hand over** and sign. In `/weaver` the rug moves to Earlier rugs as "Collected".
   - **This is the riskiest flow**: Freighter's `signAuthEntry` plus enforcing-mode simulation. If it fails, note the exact error text.

**B. Late repayment inside the buy-out window**

1. Issue and borrow for **1** month (60 s), then fund as above.
2. Wait for the due countdown to end. *rd-weaver* sees "Late: you can still repay until the store buys the rug" with the window countdown. *rd-store* sees the loan under Overdue loans with "Buy-out window closes in".
3. *rd-weaver* repays inside the window. It should succeed (agreed decision 8).

**C. Store buy-out**

1. Another 1-month loan, funded. Wait 60 s.
2. *rd-store* → Overdue loans → **Buy the rug for 600.00 USDC** and sign within the next 60 s. The investor gets back principal + interest, and the rug shows "Bought by this store".
3. *rd-store* → **Close the certificate** → confirm → sign once. This tests the store-as-holder redeem.

**D. Missed buy-out and claim**

Warning: this freezes the store for good. `rd-store2` is already frozen and can't issue a new rug, so do flow E first: approve a fresh store, import it into Freighter, and use it here. Don't use Kaya Rug House unless you're happy to lose it for the demo.
1. With a non-frozen store: issue, borrow 1 month, fund, then let both windows pass (120 s+).
2. *rd-investor* → Your loans → "Store missed buy-out" → **Take the rug** → confirm → sign. Expect the rug in "Rugs you hold", the store frozen in `/platform` as "Frozen: missed buy-out", and the store's desk showing the madder banner.
3. *rd-investor* → **Collect the rug** → link → the store co-signs (as in A6–A7). This should work even though the store is frozen.

**E. Platform**

1. *rd-admin* → `/platform` → Approve a store: paste a fresh testnet account (fund it with Friendbot first), limit `1000`. It appears under Stores.
2. **Change limit** on Kaya Rug House to `500`, then try to borrow 600 on one of its rugs as the weaver. The borrow form should warn that the store can't take the loan, and the button stays disabled. Set it back to `5000`.
3. **Freeze this store** on the fresh store → the confirm dialog → sign. Its tag reads "Frozen by the platform". Its store desk can't issue certificates.

**F. Wallet edge cases**

1. Switch Freighter to Mainnet: the chip shows "Not on Testnet", and actions refuse with a plain message.
2. On a desk, select the wrong account in Freighter (e.g. *rd-investor* on `/store`). Expect the "isn't an approved store" notice, and buttons that name the account needed.
3. A brand-new Freighter account: the chip shows "No USDC yet" with **Add USDC to wallet** (changeTrust) and a Friendbot link. Try the trustline.
4. Reload the page mid-transaction (right after signing). The top banner should report the pending action's outcome.
5. Reject a signature in Freighter. Expect "You declined to sign. Nothing was sent."

## Open questions

1. **Public URL.** Milestone 4 says "deployed to a public URL". I didn't deploy anything (no push, nothing outward). The app is fully client-side; `/rug/[id]` is the only dynamic route. Vercel with root `frontend/` should work as is. Which host do you want?
2. **Event history is ~7 days.** The testnet RPC keeps about 7 days of events, so `/activity`, timelines and the discovery of stores that aren't in the deployment file fade after a week. The app says so when it happens. See `docs/frontend-contract-requests.md` for an optional `list_stores` view. Otherwise, redeploy before the demo.
3. **Demo names.** I named the demo accounts Kaya Rug House (store), Bazaar Corner Rugs (store2), Ayşe the weaver, Deniz the investor, and RugDealer platform, all in `lib/deployment.ts`. Change them if you prefer others.
4. **Look-around mode** (`?as=`) wasn't in the plan. Keep it or remove it?
5. `.claude/launch.json` at the repo root (dev-server config for the desktop app's browser) is left untracked on purpose.

## Guide ambiguities I resolved

- **"Collect rug" = `redeem`.** It's the weaver's (or investor's) collect button and the store's co-sign. "Collected" is the label once a rug is redeemed.
- **Investor "earned".** It counts interest actually paid out: repaid, bought out and claimed. For a claim, that's the held interest only (agreed decision 2). The loan card says the principal was not returned and the rug stands in for it.
- **"Overdue" / "Late"** means funded and `now >= end_at`, matching `is_overdue`. Time comes from the browser clock, so countdowns can be a few seconds off ledger time. The contract enforces the windows either way.
- **Fee breakdown.** It shows the app's local maths at once (identical rounding, covered by tests), then confirms with the contract's `quote()` ("Figures checked with the contract"). Signing doesn't wait for the quote.
- **Store limit.** The weaver's borrow button is disabled with an explanation when the store's remaining limit is below the rug price. Funding is disabled if the store is over its limit (the contract rechecks at `fund_loan`).
- **Rug name.** The mint description is the rug's name (Fraunces) everywhere.
- **Local currency.** Whole lira at 45 per USDC, rounded half up (7.50 USDC → ≈ 338 TRY), with comma grouping as in "≈ 27,000 TRY". Inline amounts in sentences show TRY in brackets after the USDC; everywhere else it sits underneath.
- **Stores list.** There is no `list_stores` view. The platform desk shows deployment stores plus any store seen in `store_registered` events, rugs or loans.
- **Store-as-holder redeem** needs one signature. The app offers it as **Close the certificate** on the store desk, with a confirmation, because the certificate is destroyed.
- **Hand-over expiry**: about 24 hours. After that the holder signs again.
- **Platform fee note.** The platform desk says "Each new loan pays it a 1% fee, once", per the current guide (not the older 0.25%/month).
