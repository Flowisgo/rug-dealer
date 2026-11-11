# Full demo decisions

- The new contract is a fresh deployment. Prior testnet contracts and historical receipts are untouched; the API changes are explicit in the full-demo reference.
- The warehouse attests custody once per receipt ID. IDs are never reused, including after settlement. Identifying one physical rug across different IDs/deployments remains the warehouse's responsibility.
- Per-receipt credit terms include the nominated lender and dealer, advance, lender repayment, fixed custody fee, fallback price, and duration. Weaver acceptance freezes all these fields. The dealer authorizes the exact same struct; no allowance or escrow is created by this promise.
- Sale approval is separate from immutable credit terms. The weaver may approve/change a sale price that covers repayment plus custody while the loan is active and before the deadline.
- At the exact ledger timestamp of the deadline, normal sale closes and dealer purchase opens. Repayment remains available until any outcome settles. Competing transactions settle in ledger order; only the first successful settlement can clear pickup.
- The three final states distinguish sale, repayment, and dealer purchase. A separate pickup recipient avoids calling the repaying weaver a buyer.
- A zero surplus is valid; no zero-value weaver transfer is needed for a 10-USDC fallback. Every nonzero payout and state change occurs atomically with the incoming payment.
- Amounts use seven-decimal token units; calculations check overflow. Durations are 30 seconds to one day. The web default is 300 seconds, shown before acceptance; tooling can choose longer sale windows and shorter default windows for presentation preparation.
- Display metadata and receipt discovery use a local browser registry plus a checked-in public demo manifest. Neither is financial truth or an ownership record. Browser metadata is lost when local storage is cleared; cross-device metadata needs export/import or future shared storage.
