import { afterEach, expect, it, vi } from "vitest";
import { rpc, xdr, StrKey } from "@stellar/stellar-sdk";
import { getRug, simulateRead, usdcBalance } from "../lib/contract";
import { ACCOUNTS, CONTRACT_ID, USDC_ID } from "../lib/deployment";
import { invoke } from "../lib/tx";
import { AppError } from "../lib/errors";
const ext = vi.hoisted(() => ({
  isConnected: vi.fn(),
  getAddress: vi.fn(),
  getNetworkDetails: vi.fn(),
}));
vi.mock("@stellar/freighter-api", () => ext);
afterEach(() => vi.restoreAllMocks());
it("reports SAC insufficient funds, trustline absence and real missing rug separately", async () => {
  vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
    _parsed: true,
    error: "HostError: Error(Contract, #10)",
    events: [],
  } as any);
  await expect(simulateRead(USDC_ID, "transfer")).rejects.toMatchObject({
    source: "usdc",
    message: "There isn't enough test USDC in the paying wallet.",
  });
  await expect(getRug(999n)).rejects.toMatchObject({
    source: "rugdealer",
    message: "There is no rug with that number.",
  });
  vi.mocked(rpc.Server.prototype.simulateTransaction).mockResolvedValue({
    _parsed: true,
    error: "HostError: Error(Contract, #13)",
    events: [],
  } as any);
  expect(await usdcBalance(ACCOUNTS.investor)).toBeNull();
});
it("does not turn an RPC outage into a missing trustline", async () => {
  vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockRejectedValue(
    new Error("Failed to fetch"),
  );
  await expect(usdcBalance(ACCOUNTS.investor)).rejects.toThrow(
    "Failed to fetch",
  );
});
it.each([10, 13])(
  "attributes nested token error %s during a loan payment to USDC",
  async (code) => {
    const { Account } = await import("@stellar/stellar-sdk");
    const { NETWORK_PASSPHRASE } = await import("../lib/deployment");
    ext.isConnected.mockResolvedValue({ isConnected: true });
    ext.getNetworkDetails.mockResolvedValue({
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    ext.getAddress.mockResolvedValue({ address: ACCOUNTS.investor });
    vi.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(
      new Account(ACCOUNTS.investor, "1"),
    );
    const diagnostic = xdr.DiagnosticEvent.fromXdrObject({
      inSuccessfulContractCall: false,
      event: {
        ext: { v: 0 },
        contractId: StrKey.decodeContract(USDC_ID),
        type: 2,
        body: {
          v: 0,
          v0: {
            topics: [
              { type: 15, sym: new xdr.XdrString("error") },
              { type: 2, error: { type: 0, contractCode: code } },
            ],
            data: { type: 1 },
          },
        },
      },
    });
    vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      _parsed: true,
      error: `HostError: Error(Contract, #${code})`,
      events: [diagnostic],
    } as any);
    await expect(
      invoke({
        source: ACCOUNTS.investor,
        method: "fund_loan",
        args: [],
        label: "Fund rug",
      }),
    ).rejects.toMatchObject({ source: "usdc", code });
  },
);
it("preserves an RPC account lookup failure rather than asking for XLM", async () => {
  const { NETWORK_PASSPHRASE } = await import("../lib/deployment");
  const { messageOf } = await import("../lib/errors");
  ext.isConnected.mockResolvedValue({ isConnected: true });
  ext.getNetworkDetails.mockResolvedValue({
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  ext.getAddress.mockResolvedValue({ address: ACCOUNTS.investor });
  vi.spyOn(rpc.Server.prototype, "getAccount").mockRejectedValue(
    new Error("fetch failed"),
  );
  const result = await invoke({
    source: ACCOUNTS.investor,
    method: "fund_loan",
    args: [],
    label: "Fund rug",
  }).catch((e) => messageOf(e));
  expect(result).toBe(
    "Couldn't reach the Stellar testnet. Check your connection and refresh.",
  );
});
