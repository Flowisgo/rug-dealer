import { describe, expect, it } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import { ACCOUNTS } from "../lib/deployment";
import { decodeEvent, decodeNative, describe as sentence, plain, type AppEvent } from "../lib/events";
import { DEMO_NAMES } from "../lib/deployment";
import { formatUsdc } from "../lib/money";
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
const name = (a: string) => DEMO_NAMES[a]?.name ?? a.slice(0, 4);
const text = (e: AppEvent) => plain(sentence(e), name, (u) => `${formatUsdc(u)} USDC`);
const META = { id: "x", ledger: 1, at: "2026-11-12T00:00:00Z", txHash: "ab".repeat(32) };

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
  it("rug_redeemed", () => {
    const e = decodeNative(["rug_redeemed", 1n], { store: ACCOUNTS.store, holder: ACCOUNTS.weaver }, META);
    expect(text(e)).toBe("Ayşe the weaver collected rug No. 0001 from Kaya Rug House.");
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
