import { describe, expect, it } from "vitest";
import type { Loan, Rug } from "../lib/contract";
import { CONTRACT_ID, USDC_ID } from "../lib/deployment";
import { CONTRACT_ERRORS, explainError } from "../lib/errors";
import { decodeHandover, encodeHandover } from "../lib/handover";
import { clock, investorTotals, loanPhase, openLoanFor, rugLabel } from "../lib/rules";

const loan = (over: Partial<Loan>): Loan => ({
  id: 1n,
  rug_id: 1n,
  store: "S",
  weaver: "W",
  investor: "I",
  principal: 6_000_000_000n,
  months: 1,
  interest: 75_000_000n,
  platform_fee: 60_000_000n,
  store_fee: 15_000_000n,
  weaver_payout: 5_850_000_000n,
  requested_at: 0n,
  funded_at: 1000n,
  end_at: 1060n,
  status: "Funded",
  ...over,
});

describe("loan phases match the contract's half-open windows", () => {
  const l = loan({});
  const W = 60n;
  it("running before end_at", () => expect(loanPhase(l, 1059n, W)).toBe("running"));
  it("buy-out at exactly end_at", () => expect(loanPhase(l, 1060n, W)).toBe("buyout"));
  it("still buy-out one second before the window ends", () => expect(loanPhase(l, 1119n, W)).toBe("buyout"));
  it("claimable at exactly end_at + window", () => expect(loanPhase(l, 1120n, W)).toBe("claimable"));
  it("requested and settled loans", () => {
    expect(loanPhase(loan({ status: "Requested", end_at: null }), 5000n, W)).toBe("requested");
    for (const status of ["Repaid", "BoughtOut", "Claimed", "Cancelled"] as const) expect(loanPhase(loan({ status }), 5000n, W)).toBe("closed");
  });
});

describe("rug labels", () => {
  const rug = (status: Rug["status"], owner = "W"): Rug => ({ id: 1n, store: "S", description: "d", price: 1n, owner, status });
  it("uses the agreed shopkeeper words", () => {
    expect(rugLabel(rug("Free"), "W").text).toBe("At the store, free to borrow");
    expect(rugLabel(rug("Requested"), "W").text).toBe("Waiting for an investor");
    expect(rugLabel(rug("Locked"), "W").text).toBe("Held as security");
    expect(rugLabel(rug("Redeemed"), "W").text).toBe("Collected");
  });
  it("never calls a store's own bought rug free to borrow", () => {
    expect(rugLabel(rug("Free", "S")).text).toBe("Bought by the store");
    expect(rugLabel(rug("Free", "S"), "S").text).toBe("Bought by the store");
  });
  it("finds the open loan on a rug", () => {
    const loans = [loan({ id: 1n, status: "Repaid" }), loan({ id: 2n, status: "Funded" })];
    expect(openLoanFor(1n, loans)?.id).toBe(2n);
    expect(openLoanFor(9n, loans)).toBeNull();
  });
});

describe("investor totals", () => {
  it("counts lent, earned and still-to-come interest", () => {
    const loans = [
      loan({ id: 1n, status: "Repaid", interest: 450_000_000n }),
      loan({ id: 2n, status: "BoughtOut" }),
      loan({ id: 3n, status: "Claimed" }),
      loan({ id: 4n, status: "Funded" }),
      loan({ id: 5n, status: "Funded", investor: "someone else" }),
    ];
    const t = investorTotals(loans, "I");
    expect(t.lent).toBe(24_000_000_000n);
    expect(t.earned).toBe(600_000_000n); // 45 + 7.5 + 7.5
    expect(t.expected).toBe(75_000_000n);
    expect(t.open).toBe(1);
  });
});

describe("countdown clock", () => {
  it("formats seconds", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(59)).toBe("0:59");
    expect(clock(61n)).toBe("1:01");
    expect(clock(3723)).toBe("1:02:03");
    expect(clock(-5)).toBe("0:00");
  });
});

describe("contract errors", () => {
  it("maps every code 1-24 to a plain message", () => {
    for (let c = 1; c <= 24; c++) expect(CONTRACT_ERRORS[c]?.message.length).toBeGreaterThan(10);
  });
  it("names the role-check errors as the contract does", () => {
    expect([22, 23, 24].map((c) => CONTRACT_ERRORS[c].name)).toEqual(["WeaverIsStore", "StoreCannotBorrow", "InvestorIsParty"]);
  });
  it("explains a store trying to borrow", () => {
    const raw = `HostError: Error(Contract, #23)\n 0: [Diagnostic Event] contract:${CONTRACT_ID}, topics:[error, Error(Contract, #23)]`;
    expect(explainError(raw).message).toBe("Stores can't borrow against rugs. Only weavers can ask for a loan.");
  });
  it("reads a real simulation error", () => {
    const raw = `HostError: Error(Contract, #14)\n\nEvent log (newest first):\n   0: [Diagnostic Event] contract:${CONTRACT_ID}, topics:[error, Error(Contract, #14)], data:"escalating"`;
    const e = explainError(raw);
    expect(e.code).toBe(14);
    expect(e.message).toBe("There is no loan with that number.");
  });
  it("prefers the USDC contract's error when the token failed", () => {
    const raw = `Error(Contract, #10)\n 0: [Diagnostic Event] contract:${CONTRACT_ID}, topics:[error, Error(Contract, #10)]\n 1: [Diagnostic Event] contract:${USDC_ID}, topics:[error, Error(Contract, #10)]`;
    const e = explainError(raw);
    expect(e.source).toBe("usdc");
    expect(e.message).toBe("There isn't enough test USDC in the paying wallet.");
  });
  it("explains auth failures", () => {
    expect(explainError("HostError: Error(Auth, InvalidAction)").source).toBe("auth");
  });
});

describe("hand-over codes", () => {
  it("round-trip through the link format", () => {
    const h = { v: 1 as const, rug: "3", holder: "GA", store: "GB", auth: ["AAAA", "BBBB"], until: 123 };
    const code = encodeHandover(h);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeHandover(code)).toEqual(h);
  });
  it("rejects garbage", () => {
    expect(() => decodeHandover("not a code")).toThrow(/isn't valid/);
  });
});
