import { describe, expect, it } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import { ACCOUNTS } from "../lib/deployment";
import { decodeEvent, decodeNative, describe as sentence, heldPayoutLoans, heldPayoutTxs, plain, type AppEvent } from "../lib/events";
import { formatUsdc } from "../lib/money";
import { partyName } from "../lib/names";
import fixtures from "./testnet-events.json";

type Fixture = { topic: string[]; value: string; ledger: number; at: string; txHash: string; id: string };
const FIX = fixtures as Record<string, Fixture>;

const fromFixture = (name: string): AppEvent => {
  const f = FIX[name];
  return decodeEvent(
    f.topic.map((t) => xdr.ScVal.fromXDR(t, "base64")),
    xdr.ScVal.fromXDR(f.value, "base64"),
    { id: f.id, ledger: f.ledger, at: f.at, txHash: f.txHash },
  );
};
const text = (e: AppEvent) => plain(sentence(e), partyName, (u) => `${formatUsdc(u)} USDC`);
const META = { id: "x", ledger: 1, at: "2026-11-12T00:00:00Z", txHash: "ab".repeat(32) };

describe("held investor payouts", () => {
  it("decodes investor_credited and says the loan still closed", () => {
    const e = decodeNative(["investor_credited", ACCOUNTS.investor], { loan_id: 7n, amount: 6_450_000_000n }, META);
    expect(e).toMatchObject({ kind: "investor_credited", investor: ACCOUNTS.investor, loanId: 7n, amount: 6_450_000_000n });
    expect(text(e)).toBe(
      "Deniz the investor's wallet couldn't take the payout of 645.00 USDC, so the contract is holding it for them to withdraw. The loan is closed.",
    );
  });
  it("doesn't say the investor 'got back' a payout the contract had to hold", () => {
    const tx = "cd".repeat(32);
    const m = { ...META, txHash: tx };
    const repaid = decodeNative(
      ["loan_repaid", 7n],
      { rug_id: 4n, weaver: ACCOUNTS.weaver, investor: ACCOUNTS.investor, principal: 6_000_000_000n, interest: 450_000_000n },
      m,
    );
    const credited = decodeNative(["investor_credited", ACCOUNTS.investor], { loan_id: 7n, amount: 6_450_000_000n }, m);
    const held = heldPayoutTxs([repaid, credited]);
    expect(plain(sentence(repaid, held), partyName, (u) => `${formatUsdc(u)} USDC`)).toBe(
      "Ayşe the weaver repaid 600.00 USDC on rug No. 0004. Deniz the investor's wallet couldn't take the 645.00 USDC, so the contract is holding it until they withdraw it.",
    );
    expect(text(repaid)).toMatch(/got back 645.00 USDC/);
    expect(heldPayoutLoans([repaid, credited])).toEqual(new Set([7n]));
  });
  it("says a claim's interest is held when it is", () => {
    const m = { ...META, txHash: "ef".repeat(32) };
    const claimed = decodeNative(["rug_claimed", 9n], { rug_id: 5n, investor: ACCOUNTS.investor, store: ACCOUNTS.store2, interest: 75_000_000n }, m);
    const held = heldPayoutTxs([decodeNative(["investor_credited", ACCOUNTS.investor], { loan_id: 9n, amount: 75_000_000n }, m)]);
    expect(plain(sentence(claimed, held), partyName, (u) => `${formatUsdc(u)} USDC`)).toMatch(/interest is held by the contract until they withdraw it/);
  });
  it("decodes credit_withdrawn", () => {
    const e = decodeNative(["credit_withdrawn", ACCOUNTS.investor], { amount: 6_450_000_000n }, META);
    expect(e).toMatchObject({ kind: "credit_withdrawn", investor: ACCOUNTS.investor, amount: 6_450_000_000n });
    expect(text(e)).toBe("Deniz the investor withdrew 645.00 USDC the contract was holding for them.");
  });
});

describe("decoding real testnet events", () => {
  it("has a fixture for every event the demo produced", () => {
    expect(Object.keys(FIX).sort()).toEqual(
      ["loan_funded", "loan_repaid", "loan_requested", "rug_claimed", "rug_minted", "store_bought_out", "store_frozen", "store_registered"].sort(),
    );
  });

  it("store_registered", () => {
    const e = fromFixture("store_registered");
    expect(e).toMatchObject({ kind: "store_registered", store: ACCOUNTS.store, limit: 50_000_000_000n });
    expect(text(e)).toBe("The platform approved Kaya Rug House as a store, with a limit of 5,000.00 USDC.");
  });

  it("rug_minted", () => {
    const e = fromFixture("rug_minted");
    expect(e).toMatchObject({ kind: "rug_minted", rugId: 1n, store: ACCOUNTS.store, weaver: ACCOUNTS.weaver, price: 6_000_000_000n, description: "RugDealer demo - repay" });
    expect(text(e)).toBe("Kaya Rug House took in rug No. 0001 from Ayşe the weaver and priced it at 600.00 USDC.");
  });

  it("loan_requested", () => {
    const e = fromFixture("loan_requested");
    expect(e).toMatchObject({ kind: "loan_requested", loanId: 1n, rugId: 1n, months: 6, principal: 6_000_000_000n });
    expect(text(e)).toBe("Ayşe the weaver asked to borrow 600.00 USDC against rug No. 0001 for 6 months.");
  });

  it("loan_funded carries the exact split of the worked example", () => {
    const e = fromFixture("loan_funded");
    expect(e).toMatchObject({
      kind: "loan_funded",
      loanId: 1n,
      investor: ACCOUNTS.investor,
      principal: 6_000_000_000n,
      interest: 450_000_000n,
      platformFee: 60_000_000n,
      storeFee: 90_000_000n,
      weaverPayout: 5_400_000_000n,
    });
    if (e.kind !== "loan_funded") throw new Error();
    expect(e.interest + e.platformFee + e.storeFee + e.weaverPayout).toBe(e.principal);
    expect(typeof e.endAt).toBe("bigint");
    expect(text(e)).toBe("Deniz the investor lent 600.00 USDC on rug No. 0001. The weaver received 540.00 USDC.");
  });

  it("loan_repaid", () => {
    const e = fromFixture("loan_repaid");
    expect(text(e)).toBe("Ayşe the weaver repaid 600.00 USDC on rug No. 0001. Deniz the investor got back 645.00 USDC.");
  });

  it("store_bought_out", () => {
    const e = fromFixture("store_bought_out");
    expect(e).toMatchObject({ kind: "store_bought_out", rugId: 2n, store: ACCOUNTS.store });
    expect(text(e)).toBe("Kaya Rug House bought rug No. 0002 for 600.00 USDC. Deniz the investor got back 607.50 USDC.");
  });

  it("store_frozen decodes the reason enum", () => {
    const e = fromFixture("store_frozen");
    expect(e).toMatchObject({ kind: "store_frozen", store: ACCOUNTS.store2, reason: "MissedBuyout" });
    expect(text(e)).toBe("Bazaar Corner Rugs was frozen for missing a buy-out. It can no longer issue rug certificates.");
  });

  it("rug_claimed", () => {
    const e = fromFixture("rug_claimed");
    expect(e).toMatchObject({ kind: "rug_claimed", rugId: 3n, investor: ACCOUNTS.investor, store: ACCOUNTS.store2, interest: 75_000_000n });
    expect(text(e)).toBe("Deniz the investor took rug No. 0003 and 7.50 USDC interest after Bazaar Corner Rugs missed the buy-out.");
  });
});

describe("events the demo hasn't produced yet", () => {
  it("store_limit_set", () => {
    const e = decodeNative(["store_limit_set", ACCOUNTS.store], { limit: 10_000_000_000n }, META);
    expect(text(e)).toBe("The platform set the limit for Kaya Rug House to 1,000.00 USDC.");
  });
  it("store_frozen by the platform", () => {
    const e = decodeNative(["store_frozen", ACCOUNTS.store], { reason: ["Platform"] }, META);
    expect(text(e)).toBe("The platform froze Kaya Rug House. It can no longer issue rug certificates.");
  });
  it("loan_cancelled", () => {
    const e = decodeNative(["loan_cancelled", 4n], { rug_id: 4n, weaver: ACCOUNTS.weaver }, META);
    expect(e).toMatchObject({ kind: "loan_cancelled", loanId: 4n, rugId: 4n });
    expect(text(e)).toBe("Ayşe the weaver cancelled the loan request on rug No. 0004.");
  });
  it("rug_redeemed by the weaver: collected from the store", () => {
    const e = decodeNative(["rug_redeemed", 4n], { store: ACCOUNTS.store, holder: ACCOUNTS.weaver }, META);
    expect(text(e)).toBe("Ayşe the weaver collected rug No. 0004 from Kaya Rug House.");
  });
  it("rug_redeemed by the store itself: closed the certificate on a rug it bought", () => {
    const e = decodeNative(["rug_redeemed", 7n], { store: ACCOUNTS.store, holder: ACCOUNTS.store }, META);
    expect(text(e)).toBe("Kaya Rug House closed the certificate for rug No. 0007, which it had bought.");
  });
  it("names stores outside the deployment file as Store G…", () => {
    const other = "GAF3ZQXAQ6BW2J3C3TPA2K6IUCSJAE6BRWPTNRMV3H4X7R2IMJ5U6HYP";
    expect(text(decodeNative(["rug_redeemed", 7n], { store: other, holder: other }, META))).toBe(
      "Store GAF3…6HYP closed the certificate for rug No. 0007, which it had bought.",
    );
    expect(text(decodeNative(["rug_redeemed", 4n], { store: other, holder: ACCOUNTS.weaver }, META))).toBe(
      "Ayşe the weaver collected rug No. 0004 from Store GAF3…6HYP.",
    );
    expect(text(decodeNative(["store_registered", other], { limit: 10_000_000_000n }, META))).toBe(
      "The platform approved Store GAF3…6HYP as a store, with a limit of 1,000.00 USDC.",
    );
    // A weaver or investor outside the deployment stays a bare short address.
    expect(text(decodeNative(["loan_cancelled", 4n], { rug_id: 4n, weaver: other }, META))).toBe(
      "GAF3…6HYP cancelled the loan request on rug No. 0004.",
    );
  });
  it("months are singular for one", () => {
    const e = decodeNative(
      ["loan_requested", 2n],
      { rug_id: 2n, store: ACCOUNTS.store, weaver: ACCOUNTS.weaver, principal: 6_000_000_000n, months: 1 },
      META,
    );
    expect(text(e)).toContain("for 1 month.");
  });
  it("unknown events don't crash the feed", () => {
    const e = decodeNative(["something_new", 1n], {}, META);
    expect(e.kind).toBe("unknown");
    expect(text(e)).toBe('Unrecognised event "something_new".');
  });
});
