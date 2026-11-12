# Demo readiness integration validation

Date: 2026-11-12. Branch: `codex/integrate-demo-fixes`.

## Provenance and scope

- Original review base: `4b187f4f126cde872ddd56ec30c2cde5d0aa94c8`.
- Preserved local fix commit: `6894d0bb4fb3bfb77d3ec735f7e7bec3a7f517be` on `codex/demo-readiness-fixes`.
- Teammate/latest `origin/main`: `ab5f4d132c9fd7dcafd7f6a767c2b35eb3c16563`. Fetched at the start and checked again before publication; unchanged. This commit is already on main. GitHub's repository PR list showed no PR for it. The older open loan-flow PRs #3/#4 are not dependencies.
- Integration merge: `4a05e89416bf3ec7d53b1c36cd376fd48e0c7b44`, retaining both histories. The final documentation commit also belongs to the tested branch; its full SHA is recorded in the draft PR description and completion report.

Compared both implementations before resolving the merge, using the original 12-finding report and [historical fix validation](demo-fix-validation.md). The separate integration worktree preserves the original checkout and local fix branch. No product decision was needed. Only this integration branch is to be pushed; merging and deployment require a later decision. No shared Testnet writes or signatures were performed.

## All 12 findings

Numbers follow the original review report (deployment is #5, errors #6).

| # | Finding | Teammate implementation | Integrated result and evidence |
|---|---|---|---|
| 1 | Wrong rug in hand-over confirmation | Fixed identity snapshot and locked input | Kept unchanged. Added our post-confirm certificate reread and mounted `custody.test.tsx` regression: changing code while pending cannot change the confirmed rug, holder or hash. **Fixed in source.** |
| 2 | Amount parsing | Fixed dot decimals and grouping; useful `amountProblem` guidance | Kept parser and errors; added shared guidance, normalized USDC display and extra cases. `6,50` rejected; `6.50` stays 6.50, checked in tests and browser. **Fixed.** |
| 3 | Held payouts shown as received | Partial: credit events and held labels, but no withdrawal correlation | Adapted shared `loanPayout`/`eventsForRug`: held → received after withdrawal; incomplete history remains unknown. Kept teammate transaction-aware event presentation, using historical wording. Mounted investor/rug tests verify 645 held then received, timeline withdrawal, and credit-read failure. **Fixed in source; real held-credit rehearsal outstanding.** |
| 4 | Lost pending recovery | Partial: same-tab guard and a shared list; list races and lossy legacy migration remained | Kept `runExclusive`; separate keys per hash, migration from singleton AND teammate list, ongoing banner reconciliation. Public transaction tests use independent tab module contexts, both completion orders and refresh; mounted Header updates after original caller completes. New list-migration test failed before adaptation and passes after. **Fixed in source; signed browser recovery outstanding.** |
| 5 | Fresh deployment setup | Partial: `sync-deployment` command and public JSON | Kept one generator, its command and camelCase schema. Added selected manifest, account/SAC/issuer validation, automatic lifecycle hooks, feature flag and all-scenario CLI preflight. Subprocess tests verify alternate manifest and zero writes when claim store is frozen. **Fixed; deployment itself deferred.** |
| 6 | Misleading payment errors | Partial: balance-unavailable state and broader text parsing | Kept those improvements; carried typed diagnostic origin and explicit direct-call context. Unknown nested codes are not guessed to be RugDealer errors. RPC failures no longer mean missing trustline. Public read/transaction tests and live unsigned simulations distinguish insufficient USDC, missing trustline, missing rug and network outage. **Fixed.** |
| 7 | Wall-clock timing | Unchanged | Carried closed-ledger UI clock and CLI timing/preflight. Mounted tests cover end=460/window=60 at 459, 460, 519, 520 with fast/slow device clocks and unavailable RPC. Native exact-boundary tests pass. **Fixed; signed timing rehearsal outstanding.** |
| 8 | Preview can sign | Unchanged | Carried explicit `?as=` signing prohibition, including matching wallet and post-prompt guard. Mounted matching-wallet test and browser disabled controls pass. **Fixed.** |
| 9 | Claim instructions freeze prerequisite | Unchanged | Carried fresh active claim-store requirement, exact asset trustline and separate admin-freeze store. Claim freezes the claim store at the intended step. **Docs fixed; signed rehearsal outstanding.** |
| 10 | Contradictory judge copy | Unchanged | Carried demo/production timing, fee payer and delivery distinctions. Final Spec pass caught and corrected the primary guide's remaining two-outcome walkthrough: now repay, buy-out and claim, with exact credit/payment and certificate outcomes. **Source/docs fixed; public app still older.** |
| 11 | Store discovery depends on events | Unchanged | Carried direct connected-store lookup, persistent `store_count`/`store_at`, and old-deployment fallback. Rust discovers an unused/frozen store; mounted empty-history store can issue; browser shows legacy lookup notice. **Source fixed; new contract required.** |
| 12 | Deadline overflow after funding | Unchanged | Carried constructor and funding cutoff checks. Public contract tests reject unrepresentable deadlines before funds/state change. Current deployed 60/60-second settings are unaffected. **Source fixed; new contract required.** |

Earlier malformed-code, expired-code renewal, Requested/Locked redemption refusal, and held-payout settlement regressions also pass. No implementation finding remains open from the 12-item checklist; deployment and real signed acceptance are distinct outstanding work.

## Checks actually run

Node 24.22.2, Rust 1.99.1, Stellar CLI 30.0.1. Node/Rust/CLI tools and caches were under `/private/tmp`; no toolchain or secret material was committed.

| Command | Result |
|---|---|
| `npm ci --cache /private/tmp/rug-npm-cache --offline --no-audit --no-fund` in frontend | Clean dependency installation passed. |
| `npm test` on teammate snapshot before integration | 99 passed, 5 files. |
| `cargo test --locked` | 63 passed; local Soroban public contract calls and actual token balances. |
| `cargo fmt --all -- --check` | Passed. |
| `cargo clippy --locked --all-targets -- -D warnings` | Passed. |
| `stellar contract build --locked` | Passed; 24 exported functions. Build only. |
| `npm test` in frontend | 130 passed, 11 files. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed; all eight routes. |
| `npm run smoke` | 11 passed, 2 files; shared Testnet reads and unsigned simulations only. |
| `python3 -m unittest discover -s scripts/tests -v` | 1 passed; fake external CLI and temporary manifests, no network writes. |
| `RUGDEALER_STATE=/private/tmp/rug-integration-status STELLAR_CLI=/private/tmp/rug-stellar-cli/stellar python3 scripts/testnet.py status` | Passed, read-only. Main store active, claim store frozen, zero exposure. |
| `bash -n .agents/skills/diagnosing-bugs/scripts/hitl-loop.template.sh`; `git diff --check` | Passed. |
| `npm start -- --hostname 127.0.0.1 --port 3113` | Production app responded and was inspected in browser; test server stopped after verification. |

No frontend lint or formatting-check script is defined. Rust formatting and strict Clippy ran; changed integration helpers/tests were formatted with cached Prettier 3.6.2. The initial migration regression was intentionally red; a later event-copy expectation was updated to match the corrected historical wording. All final checks pass. Logs are `/private/tmp/rug-integration-{rust,clippy,wasm,tests,types,build,smoke}.log`.

## Browser evidence and limits

The production app on port 3113 read the shared deployment without sending transactions. Verified: 60-second month/window explanation; `6,50` rejection and `6.50 USDC` normalized price; malformed hand-over code error; read-only store/investor/admin preview controls; received payouts of 645, 607.5 and 7.5; rug 5's Collected state, holder and transaction-linked timeline; old-contract store-discovery fallback with three stores. Ledger time initially showed unavailable and then resolved, enabling the appropriate read-only status display.

Shared state now includes additional rugs/settlements created outside this task. Seeing rug 5's existing redemption is not a signed test of this branch. Held-credit transitions, overlapping confirmations, migration/reload and pending-banner changes were verified with mounted DOM/public transaction fixtures, not live wallet signatures. No new mobile-layout check was performed.

Chrome's Connect wallet opened Varial's `unlock-account` route. Varial remains locked; no credentials were accessed. Real transaction/auth-entry signing, wallet account/network switching, real refresh after signing and the timed demo remain **unverified**. The public `rugdealer.vercel.app` still displayed the older one-minute-only header, seven-day window and unqualified payout wording; it is not this integrated build.

## Signed acceptance before switching the public app

Use a disposable **fresh contract** and a matching public manifest, following [isolated setup](testnet-demo.md#isolated-rehearsal-and-web-configuration). The existing contract cannot provide the new store index or deadline validation. Each demo role needs test XLM and the exact selected USDC issuer's trustline; this prototype uses its own issuer, not Circle. Unlock Varial privately and connect the role needed for each step.

1. **Fund and repay:** store issues a 600 rug; weaver requests six months (also cancel/re-request once); investor funds. Verify investor −600, weaver +540, store +9, platform +6, contract +45. Repay 600: investor +645, rug Free under weaver, exposure zero.
2. **Two-signature collection:** weaver selects **Collect the rug**, signs the auth entry and sends the code/link to the store. Store selects **Sign to close the certificate**, signs and waits. Only after confirmation and the same rug/holder/hash are shown with Redeemed may the physical rug be handed over. Check input lock while pending, expired-code **Sign again**, and refusal of Requested/Locked rugs.
3. **Buy-out and store closure:** a separate one-month 600 rug; store pays during closed-ledger interval `[end, end+60)`. Investor receives 607.5; store owns the Free certificate. Store's **Close the certificate** needs one signature and ends Redeemed.
4. **Claim:** start with a different active store with the correct trustline. At `end+60`, investor claims: receives 7.5 plus the Free certificate, no 600 principal refund; store freezes then. Investor and frozen store complete two-signature collection. Use yet another store for admin-freeze testing.
5. **Wallet/recovery:** reject transaction and auth-entry prompts; wrong account/network; insufficient funds; missing trustline. Verify precise errors and no unauthorized changes. Refresh immediately after signing; check recovery and exact hash. Try overlapping independent tabs and confirm in both orders. Matching-wallet `?as=` must remain read-only.
6. **Held payout:** on a disposable authorization-controlled test asset, prevent investor receipt, settle and verify exact backed credit plus unlocked rug. Restore receipt, withdraw once and verify exact wallet increase/card/timeline change; duplicate withdrawal must fail.

Record transaction links and balance/certificate evidence for these signed checks before changing the public manifest/app. Run the documented one-pass CLI demo on a disposable deployment too; claim freezes its store, so do not replay `all` on the shared fixture.

## Standards

Final parallel Standards pass found no blocking standard violation: one generator, per-hash recovery, shared payout presentation and public workflow regression coverage. Its historical-report ambiguity was resolved with an explicit banner linking here. Standards summary: zero open blocking findings.

## Spec

Final parallel Spec pass found no new contract, custody or recovery mismatch. Its remaining primary-guide inconsistency within finding 10 was corrected to three outcomes and exact payment/credit amounts. Spec summary: zero open implementation findings after that correction; signed acceptance remains unverified.

**Verdict:** integrated source is ready for draft review. The public demo is not yet verified on this version: approve the draft, make a separate deployment decision, deploy the fresh contract, and complete the signed checks before switching it over.
