# Rug Dealer

A planned Stellar hackathon platform that helps weavers borrow against finished rugs while they look for a better buyer.

## Overview and problem

Weavers in Iran may need cash as soon as a rug is finished. Finding a buyer can take months, so they may accept a lower price from a middleman.

Our platform would let **weavers borrow from investors against finished rugs they own**, giving them time to find a better buyer. This fits the challenge’s **Problem Space 1: Access to Fair Financial Assets and Affordable Financing**.

**Status:** The first successful-sale Soroban contract and local tests are implemented. They cover an 8-token advance and a 15-token sale paying 9 to the lender, 1 to the warehouse, and 5 to the weaver. See [the contract flow, test commands, and frontend call reference](docs/first-loan-flow.md). The web app, testnet deployment, and other features below remain planned.

## How it works

1. A trusted warehouse partner verifies and holds the weaver’s rug, then registers a digital receipt on Stellar.
2. An investor funds a short-term loan against that rug.
3. When the weaver finds a buyer, the buyer pays through the Soroban contract.
4. The contract repays the lender and sends the surplus to the weaver.
5. After settlement, the warehouse releases the rug to the buyer.

The weaver could also repay the loan separately and reclaim the rug.

## What happens at default

We’re exploring a partnership with a Canadian rug importer who would agree upfront on a fallback purchase price for each rug. If a loan comes due unpaid, the dealer could buy the rug at that price and add it to an existing shipment. The sale proceeds would go toward repaying the lender.

This is a **proposed arrangement**, not a confirmed partnership or a guarantee of full repayment. The planned demo would simulate the dealer’s purchase and physical shipment.

## What runs on Stellar

The planned Soroban contract would:

- Record the digital receipt and track the loan.
- Handle payments and split payouts between the lender and weaver.
- Record when the rug is cleared for release.

The warehouse and dealer would handle appraisal, physical custody, handoff, and shipping. A contract release record would tell the warehouse that settlement is complete; the physical release would remain the warehouse’s responsibility.

## Prototype and tech stack

The planned stack is:

- **Next.js and Vercel:** web app and hosting.
- **Supabase:** accounts and rug photos.
- **Freighter and the Stellar SDK:** wallet signing and transactions.
- **Soroban on Stellar testnet with test USDC:** loan and settlement contracts.

The prototype would demonstrate two paths:

1. **Normal sale:** warehouse receipt → investor funds loan → buyer pays → lender and weaver receive payouts → rug cleared for release.
2. **Fallback purchase after default:** unpaid loan reaches its due date → simulated dealer purchase at the agreed price → proceeds go toward lender repayment → rug cleared for dealer collection.

The prototype would use **simulated funds**, with test USDC on Stellar testnet. A live pilot would require confirmed warehouse and dealer partners and a lawful payment route.
