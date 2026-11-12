# One-minute demo video

This is a script for the submission video. Record it in short clips and cut them together. The 60-second loan month makes the timing tight, so the buy-out is a separate clip.

## Before recording

1. Use Chrome with Freighter on **Testnet**. Import the demo accounts: Kaya Rug House (store), Ayşe the weaver, Deniz the investor.
2. Run `npm run dev` in `frontend/`, or use the live URL. Set the window to 1280 px wide. Close other tabs.
3. Check each demo account has test USDC (the wallet chip shows the balance).
4. **Stage the buy-out clip.** Shortly before recording clip 6, do the following:
   - Issue a rug and borrow for **1 month**.
   - Fund the loan.
   - Wait 60 s for it to become overdue.
   - The store then has **60 s** to buy, so have the store desk open and Freighter on Kaya Rug House.

## Shot list (about 60 s)

| Time | Clip | On screen | Voice-over |
|---|---|---|---|
| 0:00–0:08 | 1. Landing | Hero and the worked-example ticket | "A weaver needs cash the day a rug is finished. The store will only pay 40% of what a real buyer would. RugDealer lets her borrow that price instead of selling." |
| 0:08–0:16 | 2. Store desk | Kaya Rug House: **Issue rug certificate** for Ayşe at 600 USDC, sign | "The store prices the rug, keeps it safe, and issues a rug certificate on Stellar." |
| 0:16–0:24 | 3. Weaver desk | Ayşe picks 6 months; the breakdown shows 540.00 USDC (≈ 24,300 TRY); **Ask for 600.00 USDC**, sign | "She borrows the store's price for six months. Fees come off once: she gets 540 today." |
| 0:24–0:32 | 4. Investor desk | Deniz: **Lend 600.00 USDC**, sign; the wallet balance drops | "An investor funds the whole loan through a Soroban contract and will get 645 back." |
| 0:32–0:44 | 5. Repay and collect | Ayşe: **Repay 600.00 USDC**, then **Collect the rug** → copy link; switch to the store, open the link, **Sign and hand over** → "Rug handed over" | "She repays when she's found a buyer, and collects the rug with the store's countersignature." |
| 0:44–0:52 | 6. Buy-out (staged) | Store desk, Overdue loans: **Buy the rug for 600.00 USDC**, sign | "If she can't repay, the store must buy the rug at the price it set. That keeps the price honest, and the investor is paid either way." |
| 0:52–1:00 | 7. Activity | `/activity` feed of plain sentences; end on the woven band and the URL | "Every step is on Stellar Testnet. RugDealer: borrow against your rug, don't sell it cheap." |

## Cutting notes

- Trim the Freighter pop-ups to a beat each. Show one in full (clip 3) so viewers see a real signature.
- If clip 6 misses its 60-second window, the loan becomes claimable by the investor instead. Stage a new 1-month loan and retake.
- Don't show the Freighter secret-key import or any settings screen.
