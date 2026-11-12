# Demo-readiness fix validation

Date: 2026-11-12. Base fetched from `Flowisgo/rug-dealer` origin/main: **`4b187f4f126cde872ddd56ec30c2cde5d0aa94c8`**.

Local branch: **`codex/demo-readiness-fixes`** in the separate `rug-dealer-demo-fixes` worktree. The complete `/private/tmp/rugdealer-review-4b187f4.md` report was available; all 12 findings were checked against the current code and addressed. No finding had to be recovered from incomplete conversation history. The original checkout and other worktrees were preserved. No push, deployment, or shared Testnet write was performed.

**Verdict:** local source passes the checks below and is ready for review. **The public hackathon demo still needs the updated build and a signed wallet rehearsal.** The public site was observed with the old “loan month lasts one minute” header and unqualified seven-day buy-out copy. This branch has not been published. Durable store indexing and deadline validation require a fresh contract; the existing shared contract has neither, although its normal 60/60-second configuration is unaffected by the overflow edge case.

## All 12 findings

| # | Status | Change and evidence |
|---|---|---|
| 1 — Wrong rug in hand-over confirmation | Fixed locally | `frontend/components/rug-actions.tsx` saves immutable confirmed rug ID, holder and hash. `lib/handover.ts` rereads that exact certificate and requires Redeemed with the same holder/store before the physical-release cue. Mounted `test/custody.test.tsx` changes the pasted code from rug 1/weaver to rug 2/investor while the actual transaction is pending; checks submitted arguments, rug 1, original holder and exact confirmed hash. Red before fix, green afterward. |
| 2 — Decimal-comma parsing | Fixed locally | `lib/money.ts` accepts dot decimals and optional comma groups of exactly three digits. `6,50`, malformed grouping and double separators are rejected; `6.50` is 6.50, and `1,250.25` is 1250.25. `test/money.test.ts` contains the regression. Store and admin form guidance matches; store displays normalized USDC. Browser verified invalid `6,50`, valid `6.50` and disabled preview issuance. |
| 3 — Held payouts shown as received | Fixed locally | `lib/payouts.ts` and `components/payout.tsx` distinguish closed loan, held credit, received payout and unverified delivery. Timeline associates credit with loan/rug and the first later aggregate withdrawal. Settlement sentences no longer assert receipt. Credit-read failures are visible. Mounted investor and rug-page test verifies **645 USDC held before withdrawal and received afterward**, including both timeline events. No shared credit fixture was changed. |
| 4 — Pending recovery lost by overlap | Fixed locally | `lib/tx.ts` stores each hash separately and clears only that hash. Legacy singleton records migrate. Tests submit two actions before either signature completes, confirm in both orders, reconcile after reload, and preserve unresolved/send-error records. Malformed records cannot hide valid ones. Mounted Header regression verifies the waiting banner resolves after another caller removes a completed record. Banner polls and reconciles across storage changes. |
| 5 — Incomplete fresh deployment configuration | Fixed locally | `frontend/scripts/configure-deployment.mjs` generates all public identities from the selected manifest before dev/build/tests/typecheck/smoke, validating Testnet, ledger, accounts and asset/issuer/SAC consistency. `RUGDEALER_MANIFEST`, `RUGDEALER_STATE` and `RUGDEALER_RESULTS` are independent documented paths. CLI preflights every selected store and identity before the first write. A subprocess regression with a fake external Stellar CLI verifies a selected alternate manifest and an already-frozen claim store cause zero writes. Generator test checks every selected identity and rejects an inconsistent asset. |
| 6 — Misleading payment/network errors | Fixed locally | Simulation diagnostic events retain originating contract identity; SAC codes are separate from RugDealer codes. Bare nested errors are no longer assumed to be RugDealer errors. Balance RPC failures propagate and display an unavailable/retry message, not a trustline prompt. Account lookup distinguishes SDK account-not-found from RPC outage. Public transaction/read tests cover nested SAC insufficient balance and missing trustline, network failures, and genuine missing rug. The live unsigned SAC transfer of balance+1 and missing-rug simulations also pass. |
| 7 — Wall-clock demo timing | Fixed locally | UI eligibility uses the last closed ledger, with an explicit unavailable/checking state rather than a fabricated timestamp. Mounted page tests cover a fast/slow client clock at ledger times **459, 460, 519 and 520** for end=460/window=60, plus RPC clock failure. CLI waits on Horizon closed-ledger time and preflights timed calls. It retries only unsigned TooEarly/BuyoutWindowOpen simulations, never an uncertain signed send. Existing contract exact-boundary tests pass. Signed timing rehearsal remains manual. |
| 8 — Preview can sign | Fixed locally | Wallet context, signing guard and action controls make `?as=` read-only. A mounted matching-wallet test verifies the hand-over button is disabled and no transaction is sent. Browser store/admin/investor previews show disabled write controls and “Leave preview to sign.” The provider is wrapped in Suspense; production build passes. |
| 9 — Claim runbook freezes prerequisite | Fixed locally | `docs/frontend-status.md` now requires a fresh, active claim store with XLM and the exact deployment USDC trustline. Claim is the step that freezes it. The admin-freeze exercise uses another store. Shared `store2` stays untouched. Source/runbook verification; real signatures remain unverified. |
| 10 — Contradictory judge-facing copy | Fixed locally | README, mechanism guide, landing page, header and late-repayment explanations identify **60-second demo month/window**, planned production timing, signer-paid network fees, buy-out/claim competition, principal+interest payment or credit for repay/buy-out, and rug+interest without principal refund for claim. Public website still has old copy; no deployment performed. |
| 11 — Event-dependent store discovery | Fixed locally; new on-chain index needs deployment | Contract adds `store_count()` and zero-based `store_at(index)` backed by persistent entries; registration duplicates do not duplicate the index. Public-client Rust test discovers an un-used store and retains it after freezing. Frontend directly reads the connected store; mounted store-page test opens a registered store with no rugs or events. Fresh manifests enable the durable index. Older deployments have an explicit admin address-lookup fallback; browser verified its notice and three current stores. |
| 12 — Unrepresentable default deadline | Fixed locally; needs contract deployment | Constructor rejects maximum term+window overflow. Funding checks the entire end+window before funds or state changes. Public-client tests reject `u64::MAX` window and a near-maximum ledger timestamp, preserving Requested rug/loan and token balances. Both reproduced red before the fix. Normal deployed 60-second timing is unaffected. |

## Commands and results

Environment: Node 24.22.2, Rust 1.99.1, Stellar CLI 30.0.1. Node was available at `/private/tmp/rug-node/node-v24.22.2-darwin-arm64/bin`. Rust used `CARGO_HOME=/private/tmp/rug-rust/cargo`, `RUSTUP_HOME=/private/tmp/rug-rust/rustup`, `CARGO_TARGET_DIR=/private/tmp/rug-fresh-target` and its cargo bin directory on PATH. Build outputs were ignored or temporary.

| Command | Result |
|---|---|
| `git fetch origin main`; `git worktree add -b codex/demo-readiness-fixes <separate-path> origin/main` | Fetched/pinned the full SHA above; preserved existing work. |
| `npm ci --cache /private/tmp/rug-npm-cache --prefer-offline --no-audit --no-fund` (frontend) | Clean baseline dependency install passed. Added pinned jsdom 31.0.0 for permanent mounted regressions. |
| `cargo test --locked` | **63 passed**. Public Soroban functions and real local SAC balances. |
| `cargo fmt --all -- --check` | Passed. |
| `cargo clippy --locked --all-targets -- -D warnings` | Passed. |
| `stellar contract build --locked` | Passed; 24 exported functions, including the two store-discovery views. No deployment. |
| `npm test` (frontend) | **117 passed**, 11 files. Includes mounted pages and transaction/recovery workflows with external RPC/wallet fixtures. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed, all eight routes generated. |
| `npm run smoke` | **11 passed**, read-only against the shared Testnet contract. Includes a deliberately insufficient unsigned SAC transfer simulation. No signatures or submissions. |
| `python3 -m unittest discover -s scripts/tests -v` | **1 passed**, CLI subprocess/preflight with disposable filesystem and fake external executable; no network writes. |
| `RUGDEALER_STATE=/private/tmp/rug-fixes-status STELLAR_CLI=/private/tmp/rug-stellar-cli/stellar python3 scripts/testnet.py status` | Passed read-only from a temporary state directory. Main store active, claim store frozen, both exposure zero. |
| `python3 scripts/testnet.py --help`; `bash -n .agents/skills/diagnosing-bugs/scripts/hitl-loop.template.sh` | Passed. |
| `git diff --check` | Passed. |
| `npm start -- --hostname 127.0.0.1 --port 3112` | Final production build served successfully for browser verification; verification server stopped afterward. |

No frontend lint or formatting-check script exists in this repository. Rust formatting/Clippy were run. New test and helper files were formatted with a temporary pinned formatter, without adding a project dependency.

Recoverable failures: sandbox DNS blocked GitHub/RPC and Google Fonts until network access was allowed. The first production build exposed the preview hook above a Suspense boundary; moving the boundary fixed prerendering. The final results above are after those fixes. Diagnostic regression failures before fixes are retained as passing tests, not waived failures.

Logs for this session: `/private/tmp/rug-fixes-rust.log`, `rug-fixes-clippy.log`, `rug-fixes-wasm.log`, `rug-fixes-frontend.log`, `rug-fixes-types.log`, `rug-fixes-build.log` and `rug-fixes-smoke.log`.

## Earlier regressions and browser limits

- Malformed hand-over codes: decoder tests and browser inline-error check pass.
- Expired code renewal: mounted test discards the old saved code and offers **Sign again**. Real renewed auth-entry signing remains manual.
- Pledged-rug readiness: mounted Requested and Locked tests refuse hand-over/release instructions; contract redemption/state tests pass.
- Held-payout settlement: existing repay, buy-out, claim and withdraw tests pass. Added public-client checks cover aggregate credit **1,252.5 USDC**, preserving another loan's **7.5 USDC** interest, rejected withdrawal/auth, and failed payer rollback leaving Funded/Locked with no new credit.

Browser checks used the actual production app in the in-app browser and Chrome, reading shared Testnet. Verified decimal validation/guidance, malformed-code feedback, disabled judge-mode writes, live investor payouts **645 / 607.5 / 7.5 USDC**, rug-1 timeline/transaction links, and legacy store-discovery guidance. Final rebuilt pages were reloaded. Held-credit transitions and overlapping confirmations were exercised in mounted DOM regressions with external fixtures, **not claimed as live browser signatures**. No new mobile-layout rehearsal was performed in this fix pass.

Chrome opened Varial's unlock request. Browser policy denied access to the `chrome-extension:` page, so wallet unlock, account switching, real transaction/auth signatures, actual refresh-after-signing, and the timed signed rehearsal remain **unverified**. No password, secret key or recovery phrase was accessed. Keep secrets private; do not paste them into chat or logs.

## Manual signed acceptance on a disposable deployment

Use the exact isolated-deployment commands in [testnet-demo.md](testnet-demo.md#isolated-rehearsal-and-web-configuration). Keep the shared deployment read-only. Before a signed run, verify the web contract and issuer match that manifest; all roles need test XLM and the selected `USDC:<issuer>` trustline. Unlock Varial privately on Testnet and privately make the corresponding demo identities available. Remove `?as=` to act.

1. **Normal repayment.** As the active store, issue a fresh 600-USDC rug. As weaver, request six months; cancel once and request again. As investor, fund it. Verify investor −600, weaver +540, store +9, platform +6, contract +45. As weaver, repay 600 (top up beforehand if needed). Verify investor +645 for settlement, contract −45 relative to funding, rug Free under the weaver and store exposure released. Net full-flow investor +45, weaver −60, store +9, platform +6, contract 0.
2. **Real two-signature hand-over.** As weaver on `/weaver`, press **Collect the rug** and sign the auth-entry prompt. Copy its link. Switch Varial to the rug's store, open the link, and press **Sign to close the certificate**. Sign the transaction and wait. Expected: confirmed hash, the exact submitted rug number, the original weaver as recipient, and `get_rug.status = Redeemed`. Release that rug only after the confirmed cue. To check the race, paste another valid code while the first awaits confirmation: the success must still name the first rug/holder/hash. In a separate fixture, let a code expire and use **Sign again**; Requested/Locked rugs must stay locked.
3. **Store-owned closure.** Issue/fund another 600-USDC one-month loan. Stage the store wallet before the due ledger. Buy out on `[end, end+60)`: store pays 600; investor receives 607.5; store owns a Free certificate. Press **Close the certificate**, sign once as store, and verify Redeemed. If the window closes while signing, do not force a retry; use a fresh staged fixture or the claim path.
4. **Claim then collect.** Use a different active, approved, trustlined claim store; do not run the admin-freeze exercise on it. Issue/fund a one-month loan and wait until the closed ledger reaches `end+60`. As investor, **Take the rug**. Verify interest 7.5 (or credit), no 600 principal refund, investor owns the Free rug, and the store becomes frozen at this step. Investor signs collection; the frozen store co-signs redemption. Expect Redeemed despite the freeze. Run the separate admin freeze on another disposable store.
5. **Recovery and refusal.** Reject both transaction and auth-entry prompts; verify no submitted transaction for a rejected prompt. Test wrong account/network, insufficient USDC and missing trustline: messages must name the actual repair. Reload after signing: each submitted hash must remain recoverable and eventually report its own outcome, including overlapping actions that confirm out of order. Matching-wallet `?as=` must remain read-only until preview is exited.
6. **Held payout.** On an authorization-controlled disposable asset, prevent the investor from receiving, settle, and verify exact backed credit with the rug unlocked. The card must say held, not received. Restore receipt capability and withdraw once; verify exact balance increase, zero credit, received status and the withdrawal on each affected rug's timeline. Duplicate withdrawal must fail without further funds moving.

## Standards

Final independent standards pass: **0 hard violations, 0 unresolved actionable design findings**. Its malformed-record recovery and unavailable-clock findings were fixed and independently retested; the targeted transaction, pending-banner and payout tests passed.

## Spec

Final independent spec pass: **0 unresolved findings** across the 12-item report. Additional account-lookup error and stale pending-banner cases were fixed and independently retested. Documentation corrections were reread. New contract deployment and real wallet acceptance remain outstanding; neither is claimed complete.
