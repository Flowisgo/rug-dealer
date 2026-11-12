import { describe, expect, it } from "vitest";
import { formatLocal, formatUsdc, localLabel, parseUsdc, quoteLocally, rugNo, UNIT, usdcLabel } from "../lib/money";

const PARAMS = { interest_bps_per_year: 1500, platform_fee_bps: 100, store_fee_bps_per_month: 25 };
const usdc = (n: number) => BigInt(Math.round(n * 1e7));

describe("worked example: 600 USDC for 6 months", () => {
  const q = quoteLocally(600n * UNIT, 6, PARAMS);

  it("matches the guide exactly, to the base unit", () => {
    expect(q.principal).toBe(6_000_000_000n);
    expect(q.interest).toBe(450_000_000n); // 45
    expect(q.platform_fee).toBe(60_000_000n); // 6
    expect(q.store_fee).toBe(90_000_000n); // 9
    expect(q.weaver_payout).toBe(5_400_000_000n); // 540
    expect(q.investor_payout).toBe(6_450_000_000n); // 645
  });

  it("formats like the screens show it", () => {
    expect(usdcLabel(q.weaver_payout)).toBe("540.00 USDC");
    expect(usdcLabel(q.investor_payout)).toBe("645.00 USDC");
    expect(localLabel(q.principal)).toBe("≈ 27,000 TRY");
  });

  it("matches the 1-month demo scenario (buy-out / claim)", () => {
    const one = quoteLocally(600n * UNIT, 1, PARAMS);
    expect(one.interest).toBe(usdc(7.5));
    expect(one.store_fee).toBe(usdc(1.5));
    expect(one.weaver_payout).toBe(usdc(585));
  });
});

describe("fee rounding", () => {
  it("rounds each fee down and gives the remainder to the weaver", () => {
    // 1 base unit for 7 months: every fee rounds to zero.
    const tiny = quoteLocally(1n, 7, PARAMS);
    expect([tiny.interest, tiny.platform_fee, tiny.store_fee, tiny.weaver_payout]).toEqual([0n, 0n, 0n, 1n]);
    // 333.3333333 USDC for 7 months.
    const odd = quoteLocally(3_333_333_333n, 7, PARAMS);
    expect(odd.interest).toBe((3_333_333_333n * 1500n * 7n) / 120_000n);
    expect(odd.platform_fee).toBe(33_333_333n);
    expect(odd.store_fee).toBe(58_333_333n);
  });

  it("never creates or loses money: fees + payout == principal", () => {
    const principals = [1n, 7n, 99n, 12_345n, 999_999_999n, 6_000_000_000n, 3_333_333_333n, 123_456_789_012n];
    for (const p of principals)
      for (let m = 1; m <= 12; m++) {
        const q = quoteLocally(p, m, PARAMS);
        expect(q.interest + q.platform_fee + q.store_fee + q.weaver_payout).toBe(p);
        expect(q.investor_payout).toBe(p + q.interest);
        expect(q.weaver_payout).toBeGreaterThanOrEqual(0n);
      }
  });
});

describe("parseUsdc", () => {
  it("reads typed amounts", () => {
    expect(parseUsdc("600")).toBe(6_000_000_000n);
    expect(parseUsdc("600.5")).toBe(6_005_000_000n);
    expect(parseUsdc(" 1,250.25 ")).toBe(12_502_500_000n);
    expect(parseUsdc("0.0000001")).toBe(1n);
    expect(parseUsdc("0")).toBe(0n);
    expect(parseUsdc("5.")).toBe(50_000_000n);
  });
  it("rejects anything else", () => {
    for (const bad of ["", "abc", "-5", "1.12345678", "1e3", "1.2.3", ".5"]) expect(parseUsdc(bad)).toBeNull();
  });
});

describe("formatting", () => {
  it("shows two decimals, more only when needed", () => {
    expect(formatUsdc(6_000_000_000n)).toBe("600.00");
    expect(formatUsdc(75_000_000n)).toBe("7.50");
    expect(formatUsdc(1n)).toBe("0.0000001");
    expect(formatUsdc(50_000_000_000n)).toBe("5,000.00");
    expect(formatUsdc(-600_000_000n)).toBe("-60.00");
  });
  it("converts to lira at 45, rounding half up", () => {
    expect(formatLocal(6_000_000_000n)).toBe("27,000");
    expect(formatLocal(75_000_000n)).toBe("338"); // 337.5
    expect(formatLocal(50_000_000_000n)).toBe("225,000");
    expect(formatLocal(0n)).toBe("0");
  });
  it("prints rug numbers for the sewn-on label", () => {
    expect(rugNo(42n)).toBe("No. 0042");
    expect(rugNo(12345)).toBe("No. 12345");
  });
});
