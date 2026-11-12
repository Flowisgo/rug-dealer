import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Account, rpc } from "@stellar/stellar-sdk";
import {
  addUsdcTrustline,
  invoke,
  loadPending,
  loadPendings,
  resumePendings,
} from "../lib/tx";
import { assertSigner } from "../lib/wallet";
import { ACCOUNTS, CONTRACT_ID, NETWORK_PASSPHRASE } from "../lib/deployment";
const ext = vi.hoisted(() => ({
  isConnected: vi.fn(),
  isAllowed: vi.fn(),
  getAddress: vi.fn(),
  getNetworkDetails: vi.fn(),
  requestAccess: vi.fn(),
  signTransaction: vi.fn(),
  signAuthEntry: vi.fn(),
}));
vi.mock("@stellar/freighter-api", () => ext);
const key = `rugdealer:${CONTRACT_ID}:pending`;
const old = "f".repeat(64);
const remember = (age: number) =>
  localStorage.setItem(
    key,
    JSON.stringify({
      hash: old,
      source: ACCOUNTS.weaver,
      label: "Old action",
      at: Date.now() - age,
    }),
  );
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  ext.isConnected.mockResolvedValue({ isConnected: true });
  ext.getAddress.mockResolvedValue({ address: ACCOUNTS.weaver });
  ext.getNetworkDetails.mockResolvedValue({
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  ext.signTransaction.mockImplementation(async (s: string) => ({
    signedTxXdr: s,
    signerAddress: ACCOUNTS.weaver,
  }));
  vi.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(
    new Account(ACCOUNTS.weaver, "1"),
  );
  vi.spyOn(rpc.Server.prototype, "getTransaction").mockResolvedValue({
    status: "NOT_FOUND",
  } as any);
  vi.spyOn(rpc.Server.prototype, "sendTransaction").mockResolvedValue({
    status: "PENDING",
  } as any);
  vi.spyOn(rpc.Server.prototype, "pollTransaction").mockResolvedValue({
    status: "SUCCESS",
  } as any);
});
afterEach(() => vi.restoreAllMocks());
it("expired pending no longer blocks the next trustline transaction", async () => {
  remember(300000);
  await expect(addUsdcTrustline(ACCOUNTS.weaver)).resolves.toHaveProperty(
    "hash",
  );
  expect(loadPending()).toBeNull();
});
it("unresolved pending blocks trustline and preserves the original hash", async () => {
  remember(1000);
  await expect(addUsdcTrustline(ACCOUNTS.weaver)).rejects.toThrow(
    "earlier transaction",
  );
  expect(loadPending()?.hash).toBe(old);
  expect(rpc.Server.prototype.sendTransaction).not.toHaveBeenCalled();
});
it("wallet rejection sends no transaction and persists no hash", async () => {
  ext.signTransaction.mockResolvedValue({
    error: { message: "rejected by user" },
  });
  await expect(addUsdcTrustline(ACCOUNTS.weaver)).rejects.toThrow(
    "rejected by user",
  );
  expect(rpc.Server.prototype.sendTransaction).not.toHaveBeenCalled();
  expect(loadPending()).toBeNull();
});
it("wrong network stops before any submission", async () => {
  ext.getNetworkDetails.mockResolvedValue({
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  });
  await expect(addUsdcTrustline(ACCOUNTS.weaver)).rejects.toThrow(
    "not on Testnet",
  );
  expect(rpc.Server.prototype.sendTransaction).not.toHaveBeenCalled();
});
it("wrong account stops before any submission", async () => {
  await expect(assertSigner(ACCOUNTS.store)).rejects.toThrow(
    "different account selected",
  );
  expect(rpc.Server.prototype.sendTransaction).not.toHaveBeenCalled();
});
it("a send transport error keeps the submitted hash for later recovery", async () => {
  vi.mocked(rpc.Server.prototype.sendTransaction).mockRejectedValue(
    new Error("network lost"),
  );
  await expect(addUsdcTrustline(ACCOUNTS.weaver)).rejects.toThrow(
    "network lost",
  );
  expect(loadPending()?.hash).toMatch(/^[0-9a-f]{64}$/);
});
it.each([0, 1])(
  "keeps each overlapping action through refresh and completion order %s",
  async (firstToFinish) => {
    const releaseSign: Array<() => void> = [];
    const finishPoll: Array<(v: any) => void> = [];
    let seq = 1;
    vi.mocked(rpc.Server.prototype.getAccount).mockImplementation(
      async () => new Account(ACCOUNTS.weaver, String(seq++)),
    );
    ext.signTransaction.mockImplementation(
      (s: string) =>
        new Promise((resolve) =>
          releaseSign.push(() =>
            resolve({ signedTxXdr: s, signerAddress: ACCOUNTS.weaver }),
          ),
        ),
    );
    vi.mocked(rpc.Server.prototype.pollTransaction).mockImplementation(
      () => new Promise((resolve) => finishPoll.push(resolve)) as any,
    );
    const first = addUsdcTrustline(ACCOUNTS.weaver);
    const second = addUsdcTrustline(ACCOUNTS.weaver);
    await vi.waitFor(() => expect(releaseSign).toHaveLength(2));
    releaseSign[0]();
    await vi.waitFor(() => expect(finishPoll).toHaveLength(1));
    releaseSign[1]();
    await vi.waitFor(() => expect(finishPoll).toHaveLength(2));
    const saved = loadPendings();
    expect(saved).toHaveLength(2);
    // Reload reconciliation does not depend on either original promise.
    expect((await resumePendings()).map((r) => r?.status)).toEqual([
      "NOT_FOUND",
      "NOT_FOUND",
    ]);
    const completedHash = vi.mocked(rpc.Server.prototype.pollTransaction).mock
      .calls[firstToFinish][0];
    const survivor = saved.find((p) => p.hash !== completedHash)!;
    finishPoll[firstToFinish]({ status: "SUCCESS" });
    await [first, second][firstToFinish];
    expect(loadPendings()).toEqual([survivor]);
    vi.mocked(rpc.Server.prototype.getTransaction).mockResolvedValue({
      status: "SUCCESS",
    } as any);
    expect(await resumePendings()).toEqual([
      { pending: survivor, status: "SUCCESS" },
    ]);
    expect(loadPendings()).toEqual([]);
    finishPoll[1 - firstToFinish]({ status: "SUCCESS" });
    await [first, second][1 - firstToFinish];
  },
);
