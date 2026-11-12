// Read-only smoke test against the live testnet deployment.
// Only simulations and RPC reads: nothing is signed, nothing is sent.
import { beforeAll, describe, expect, it } from "vitest";
import {
  addr,
  getConfig,
  getCredit,
  getLoan,
  getRug,
  getStore,
  i128,
  listLoans,
  listRugs,
  quote,
  simulateRead,
  str,
  u32,
  u64,
  usdcBalance,
  type Config,
} from "../lib/contract";
import { ACCOUNTS, CONTRACT_ID, USDC_ID } from "../lib/deployment";
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

  // Simulations only: the contract's role checks, without signing or sending.
  it("refuses a certificate issued to a store", async () => {
    await expect(
      simulateRead(CONTRACT_ID, "mint_rug", [addr(ACCOUNTS.store), addr(ACCOUNTS.store), str("smoke test"), i128(600n * UNIT)]),
    ).rejects.toMatchObject({ code: 22 });
  });

  it("refuses a store borrowing against a rug it bought", async () => {
    const bought = (await listRugs()).find((r) => r.owner === ACCOUNTS.store && r.store === ACCOUNTS.store && r.status === "Free");
    expect(bought, "the buy-out demo leaves the store holding a free rug").toBeDefined();
    await expect(simulateRead(CONTRACT_ID, "request_loan", [addr(ACCOUNTS.store), u64(bought!.id), u32(1)])).rejects.toMatchObject({ code: 23 });
  });

  it("holds no payout for the demo investor after normal settlement", async () => {
    expect(await getCredit(ACCOUNTS.investor)).toBe(0n);
  });

  it("refuses a withdrawal when nothing is held", async () => {
    await expect(simulateRead(CONTRACT_ID, "withdraw_credit", [addr(ACCOUNTS.investor)])).rejects.toMatchObject({ code: 25 });
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
