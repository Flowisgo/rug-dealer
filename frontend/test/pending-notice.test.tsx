import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Account, rpc, nativeToScVal } from "@stellar/stellar-sdk";
import { Header } from "../components/shell";
import { WalletProvider } from "../components/wallet";
import { addUsdcTrustline } from "../lib/tx";
import { ACCOUNTS, NETWORK_PASSPHRASE } from "../lib/deployment";
const ext = vi.hoisted(() => ({
  isConnected: vi.fn(),
  isAllowed: vi.fn(),
  getAddress: vi.fn(),
  getNetworkDetails: vi.fn(),
  signTransaction: vi.fn(),
}));
vi.mock("@stellar/freighter-api", () => ext);
vi.mock("next/navigation", () => ({
  usePathname: () => "/store",
  useSearchParams: () => new URLSearchParams(),
}));
let root: Root, element: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  ext.isConnected.mockResolvedValue({ isConnected: true });
  ext.isAllowed.mockResolvedValue({ isAllowed: true });
  ext.getAddress.mockResolvedValue({ address: ACCOUNTS.store });
  ext.getNetworkDetails.mockResolvedValue({
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  ext.signTransaction.mockImplementation(async (s: string) => ({
    signedTxXdr: s,
    signerAddress: ACCOUNTS.store,
  }));
  vi.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(
    new Account(ACCOUNTS.store, "1"),
  );
  vi.spyOn(rpc.Server.prototype, "sendTransaction").mockResolvedValue({
    status: "PENDING",
  } as any);
  vi.spyOn(rpc.Server.prototype, "getTransaction").mockResolvedValue({
    status: "NOT_FOUND",
  } as any);
  vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
    _parsed: true,
    result: { retval: nativeToScVal(0n) },
  } as any);
  vi.spyOn(rpc.Server.prototype, "getHealth").mockResolvedValue({
    oldestLedger: 1,
  } as any);
  vi.spyOn(rpc.Server.prototype, "getEvents").mockResolvedValue({
    events: [],
  } as any);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("updates an observed pending action when its original caller confirms and removes the record", async () => {
  let finish!: (v: any) => void;
  vi.spyOn(rpc.Server.prototype, "pollTransaction").mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }) as any,
  );
  const action = addUsdcTrustline(ACCOUNTS.store);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () =>
    root.render(
      <WalletProvider>
        <Header />
      </WalletProvider>,
    ),
  );
  expect(element.textContent).toContain("is still waiting");
  vi.mocked(rpc.Server.prototype.getTransaction).mockResolvedValue({
    status: "SUCCESS",
  } as any);
  await act(async () => {
    finish({ status: "SUCCESS" });
    await action;
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(element.textContent).toContain("went through");
  expect(element.textContent).not.toContain("is still waiting");
});
