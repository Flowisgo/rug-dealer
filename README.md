# Rug Dealer

A planned Stellar hackathon platform that helps weavers borrow against finished rugs while they look for a better buyer.

## Overview and problem

Weavers in Iran may need cash as soon as a rug is finished. Finding a buyer can take months, so they may accept a lower price from a middleman.

Our platform would let **weavers borrow from investors against finished rugs they own**, giving them time to find a better buyer. This fits the challenge’s **Problem Space 1: Access to Fair Financial Assets and Affordable Financing**.

**Status:** The full testnet demo implements normal sale, direct repayment, and a paid dealer purchase after the deadline, with five wallet-based role pages. Start with [the demo guide](docs/full-demo.md), [contract API](docs/full-demo-api.md), and [verification report](docs/full-demo-verification.md). The wider platform and physical partner arrangements below remain planned.

## How it works

1. A trusted warehouse partner verifies and holds the weaver’s rug, then registers a digital receipt on Stellar.
2. An investor funds a short-term loan against that rug.
3. When the weaver finds a buyer, the buyer pays through the Soroban contract.
4. The contract repays the lender and sends the surplus to the weaver.
5. After settlement, the warehouse releases the rug to the buyer.

The weaver can also repay the loan separately and reclaim the rug. The testnet demo includes this path; physical custody and release are simulated.

## What happens at default

We’re exploring a partnership with a Canadian rug importer who would agree upfront on a fallback purchase price for each rug. If a loan comes due unpaid, the dealer could buy the rug at that price and add it to an existing shipment. The sale proceeds would go toward repaying the lender.

This is a **proposed arrangement**, not a confirmed partnership or a guarantee of full repayment. The demo simulates this partnership and shipping arrangement; a separate dealer wallet must actually pay test USDC before settlement. An unpaid overdue rug stays locked.

## What runs on Stellar

The testnet Soroban contract:

- Records the digital receipt, accepted terms, dealer commitment, and loan deadline.
- Handles payments and splits payouts among the lender, warehouse, and weaver.
- Records the purchaser and who is cleared to collect the rug after settlement.

The warehouse and dealer would handle appraisal, physical custody, handoff, and shipping. A contract release record would tell the warehouse that settlement is complete; the physical release would remain the warehouse’s responsibility.

## Prototype and tech stack

The demo uses Next.js, Varial / Freighter, the Stellar SDK, and Soroban on Stellar testnet with Circle test USDC. The wider planned stack includes:

- **Next.js and Vercel:** web app and hosting.
- **Supabase:** accounts and rug photos.
- **Freighter and the Stellar SDK:** wallet signing and transactions.
- **Soroban on Stellar testnet with test USDC:** loan and settlement contracts.

The prototype demonstrates three paths:

1. **Normal sale:** receipt → weaver accepts terms → dealer commits → lender advances 8 → buyer pays the approved 15 → lender receives 9, warehouse 1, weaver 5 → buyer cleared for pickup.
2. **Direct repayment:** weaver pays 10 → lender receives 9 and warehouse 1 → weaver cleared for pickup. Repayment remains available after the deadline.
3. **Fallback purchase after default:** unpaid loan reaches its deadline → committed dealer pays 10 → lender receives 9 and warehouse 1 → dealer cleared for pickup.

The prototype uses **simulated funds**, with test USDC on Stellar testnet. A live pilot would require confirmed warehouse and dealer partners and a lawful payment route.
