import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { nativeToScVal, scValToNative, rpc } from "@stellar/stellar-sdk";
import StorePage from "../app/store/page";
import InvestorPage from "../app/investor/page";
import RugPage from "../app/rug/[id]/page";
import { WalletProvider } from "../components/wallet";
import { refreshLedger } from "../lib/use-ledger";
import { ACCOUNTS as A, DEPLOY_LEDGER } from "../lib/deployment";
const route = vi.hoisted(() => ({ query: "as=investor" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(route.query),
  useParams: () => ({ id: "1" }),
}));
vi.mock("@stellar/freighter-api", () => ({
  isConnected: async () => ({ isConnected: false }),
}));
let root: Root,
  container: HTMLDivElement,
  withdrawn = false;
const rug = {
  id: 1n,
  store: A.store,
  owner: A.weaver,
  status: ["Free"],
  description: "Credit rug",
  price: 6000000000n,
};
const loan = {
  id: 1n,
  rug_id: 1n,
  store: A.store,
  weaver: A.weaver,
  investor: A.investor,
  status: ["Repaid"],
  principal: 6000000000n,
  interest: 450000000n,
  platform_fee: 60000000n,
  store_fee: 90000000n,
  weaver_payout: 5400000000n,
  months: 6,
  requested_at: 100n,
  funded_at: 100n,
  end_at: 460n,
};
const event = (
  kind: string,
  topic: string | bigint,
  data: object,
  n: number,
) => ({
  id: String(n),
  ledger: DEPLOY_LEDGER + n,
  ledgerClosedAt: "2026-11-12T12:00:00Z",
  txHash: n === 3 ? "b".repeat(64) : "a".repeat(64),
  topic: [nativeToScVal(kind, { type: "symbol" }), nativeToScVal(topic)],
  value: nativeToScVal(data),
});
beforeEach(() => {
  withdrawn = false;
  route.query = "as=investor";
  vi.restoreAllMocks();
  vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({
    sequence: 100,
  } as any);
  vi.spyOn(rpc.Server.prototype, "getLedgers").mockResolvedValue({
    ledgers: [{ ledgerCloseTime: "459" }],
  } as any);
  vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockImplementation(
    async (tx: any) => {
      const method = tx.operations[0].func.value.functionName.toString();
      const values: Record<string, unknown> = {
        get_config: {
          admin: A.admin,
          usdc: A.issuer,
          fee_recipient: A.admin,
          interest_bps_per_year: 1500,
          platform_fee_bps: 100,
          store_fee_bps_per_month: 25,
          max_months: 12,
          month_seconds: 60n,
          buyout_window_seconds: 60n,
        },
        next_rug_id: 2n,
        next_loan_id: 2n,
        get_rug: rug,
        get_loan: loan,
        get_store: {
          address:
            method === "get_store"
              ? String(scValToNative(tx.operations[0].func.value.args[0]))
              : A.store,
          limit: 50000000000n,
          open_principal: 0n,
          frozen: false,
        },
        get_credit: withdrawn ? 0n : 6450000000n,
      };
      return {
        _parsed: true,
        result: { retval: nativeToScVal(values[method] ?? 0n) },
      } as any;
    },
  );
  vi.spyOn(rpc.Server.prototype, "getHealth").mockResolvedValue({
    oldestLedger: DEPLOY_LEDGER,
    latestLedger: DEPLOY_LEDGER + 9,
  } as any);
  vi.spyOn(rpc.Server.prototype, "getEvents").mockImplementation(
    async () =>
      ({
        events: [
          event(
            "investor_credited",
            A.investor,
            { loan_id: 1n, amount: 6450000000n },
            1,
          ),
          event(
            "loan_repaid",
            1n,
            {
              rug_id: 1n,
              weaver: A.weaver,
              investor: A.investor,
              principal: 6000000000n,
              interest: 450000000n,
            },
            2,
          ),
          ...(withdrawn
            ? [
                event(
                  "credit_withdrawn",
                  A.investor,
                  { amount: 6450000000n },
                  3,
                ),
              ]
            : []),
        ],
      }) as any,
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
it("shows held and then delivered 645 USDC on the investor card and rug timeline", async () => {
  await act(async () => {
    await refreshLedger();
    root.render(
      <WalletProvider>
        <InvestorPage />
        <RugPage />
      </WalletProvider>,
    );
  });
  expect(container.textContent).not.toContain("got back");
  expect(container.textContent).toContain("Held as credit: 645.00 USDC");
  expect(container.querySelector(".timeline")?.textContent).toContain(
    "wallet couldn't take the payout",
  );
  withdrawn = true;
  await act(async () => {
    await refreshLedger();
  });
  expect(container.textContent).toContain("Received: 645.00 USDC");
  expect(container.textContent).not.toContain("Held as credit:");
  expect(container.querySelector(".timeline")?.textContent).toContain(
    "withdrew 645.00 USDC",
  );
});
it.each([
  [459, "Running", false],
  [460, "Overdue", false],
  [519, "Overdue", false],
  [520, "Store missed buy-out", true],
] as const)(
  "uses closed ledger time %s despite client clock skew",
  async (closedAt, status, claimable) => {
    const previous = loan.status;
    loan.status = ["Funded"];
    vi.spyOn(Date, "now").mockReturnValue(
      claimable ? 1_000 : 9_000_000_000_000,
    );
    vi.mocked(rpc.Server.prototype.getLedgers).mockResolvedValue({
      ledgers: [{ ledgerCloseTime: String(closedAt) }],
    } as any);
    try {
      await act(async () => {
        await refreshLedger();
        root.render(
          <WalletProvider>
            <InvestorPage />
          </WalletProvider>,
        );
      });
      expect(container.textContent?.includes("Take the rug")).toBe(claimable);
      expect(container.textContent).toContain(status);
    } finally {
      loan.status = previous;
    }
  },
);

it("opens a registered first-time store with no registration event or rugs", async () => {
  route.query = `as=${A.issuer}`;
  vi.mocked(rpc.Server.prototype.getEvents).mockResolvedValue({
    events: [],
  } as any);
  await act(async () => {
    await refreshLedger();
    root.render(
      <WalletProvider>
        <StorePage />
      </WalletProvider>,
    );
  });
  await act(async () => {
    await refreshLedger();
  });
  expect(container.textContent).toContain("Issue rug certificate");
  expect(container.textContent).not.toContain("isn't an approved store");
});
it("reports an unavailable credit read instead of hiding it as zero", async () => {
  const original = vi
    .mocked(rpc.Server.prototype.simulateTransaction)
    .getMockImplementation()!;
  vi.mocked(rpc.Server.prototype.simulateTransaction).mockImplementation(
    async (...args: any[]) => {
      if (
        args[0].operations[0].func.value.functionName.toString() ===
        "get_credit"
      )
        throw new Error("Failed to fetch");
      return original(...(args as Parameters<typeof original>));
    },
  );
  await act(async () => {
    await refreshLedger();
    root.render(
      <WalletProvider>
        <InvestorPage />
      </WalletProvider>,
    );
  });
  expect(container.textContent).toContain("Held payout balance unavailable");
  expect(container.textContent).toContain("Couldn't reach the Stellar testnet");
});
it("reports unavailable ledger time without calling an overdue loan Running", async () => {
  const previous = loan.status;
  loan.status = ["Funded"];
  vi.mocked(rpc.Server.prototype.getLedgers).mockRejectedValue(
    new Error("RPC unavailable"),
  );
  try {
    await act(async () => {
      await refreshLedger();
      root.render(
        <WalletProvider>
          <InvestorPage />
        </WalletProvider>,
      );
    });
    expect(container.textContent).toContain("Ledger time unavailable");
    expect(container.textContent).not.toContain("Running");
    expect(container.textContent).not.toContain("Take the rug");
  } finally {
    loan.status = previous;
  }
});
