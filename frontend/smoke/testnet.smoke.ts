// Read-only smoke test against the live testnet deployment.
// Only simulations and RPC reads: nothing is signed, nothing is sent.
import { beforeAll, describe, expect, it } from "vitest";
import { getConfig, getLoan, getRug, getStore, listLoans, listRugs, quote, usdcBalance, type Config } from "../lib/contract";
import { ACCOUNTS, USDC_ID } from "../lib/deployment";
import { fetchEvents } from "../lib/events";
import { quoteLocally, UNIT } from "../lib/money";

let config: Config;
beforeAll(async () => {
  config = await getConfig();
});

describe("testnet deployment", () => {
  it("has the documented parameters", () => {
    expect(config).toMatchObject({
      admin: ACCOUNTS.admin,
      usdc: USDC_ID,
      fee_recipient: ACCOUNTS.admin,
      interest_bps_per_year: 1500,
      platform_fee_bps: 100,
      store_fee_bps_per_month: 25,
      max_months: 12,
      month_seconds: 60n,
      buyout_window_seconds: 60n,
    });
  });

  it("quote() agrees with the app's own maths for every month", async () => {
    for (const m of [1, 6, 12]) {
      expect(await quote(600n * UNIT, m)).toEqual(quoteLocally(600n * UNIT, m, config));
    }
  });

  it("reads the demo rugs, loans and stores", async () => {
    const [rugs, loans] = await Promise.all([listRugs(), listLoans()]);
    expect(rugs.length).toBeGreaterThanOrEqual(3);
    expect(loans.length).toBeGreaterThanOrEqual(3);
    expect((await getRug(1n)).store).toBe(ACCOUNTS.store);
    expect((await getLoan(3n)).status).toBe("Claimed");
    expect((await getStore(ACCOUNTS.store2)).frozen).toBe(true);
  });

  it("maps a missing loan to the plain error", async () => {
    await expect(getLoan(999_999n)).rejects.toMatchObject({ code: 14 });
  });

  it("reads USDC balances", async () => {
    expect(typeof (await usdcBalance(ACCOUNTS.investor))).toBe("bigint");
  });

  it("decodes every contract event into a known kind", async () => {
    const { events } = await fetchEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events.filter((e) => e.kind === "unknown")).toEqual([]);
  });
});
