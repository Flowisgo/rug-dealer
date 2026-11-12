import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Account,
  Address,
  SorobanDataBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { WalletProvider } from "../components/wallet";
import { CoSignPanel, HandoverPanel } from "../components/rug-actions";
import { ACCOUNTS, CONTRACT_ID, NETWORK_PASSPHRASE } from "../lib/deployment";
import { encodeHandover, handoverKey, type Handover } from "../lib/handover";
const extension = vi.hoisted(() => ({
  isConnected: vi.fn(),
  isAllowed: vi.fn(),
  getAddress: vi.fn(),
  getNetworkDetails: vi.fn(),
  requestAccess: vi.fn(),
  signTransaction: vi.fn(),
  signAuthEntry: vi.fn(),
}));
vi.mock("@stellar/freighter-api", () => extension);
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
let root: Root;
let container: HTMLDivElement;
let complete: (x: any) => void;
let poll: ReturnType<typeof vi.spyOn>;
const entry = new xdr.SorobanAuthorizationEntry({
  credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
  rootInvocation: new xdr.SorobanAuthorizedInvocation({
    function:
      xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
          functionName: "redeem",
          args: [],
        }),
      ),
    subInvocations: [],
  }),
}).toXDR("base64");
const h = (rug: string, holder = ACCOUNTS.weaver): Handover => ({
  v: 1,
  rug,
  holder,
  store: ACCOUNTS.store,
  auth: [entry],
  until: 1000,
  contract: CONTRACT_ID,
});
const rugs = [
  {
    id: 1n,
    store: ACCOUNTS.store,
    owner: ACCOUNTS.weaver,
    status: "Free" as const,
    description: "First rug",
    price: 6000000000n,
  },
  {
    id: 2n,
    store: ACCOUNTS.store,
    owner: ACCOUNTS.investor,
    status: "Free" as const,
    description: "Second rug",
    price: 6000000000n,
  },
];
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.restoreAllMocks();
  localStorage.clear();
  extension.isConnected.mockResolvedValue({ isConnected: true });
  extension.isAllowed.mockResolvedValue({ isAllowed: true });
  extension.getAddress.mockResolvedValue({ address: ACCOUNTS.store });
  extension.getNetworkDetails.mockResolvedValue({
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  extension.signTransaction.mockImplementation(async (s: string) => ({
    signedTxXdr: s,
    signerAddress: ACCOUNTS.store,
  }));
  vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({
    sequence: 100,
  } as any);
  vi.spyOn(rpc.Server.prototype, "getLedgers").mockResolvedValue({
    ledgers: [{ ledgerCloseTime: "1000" }],
  } as any);
  vi.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(
    new Account(ACCOUNTS.store, "1"),
  );
  vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockImplementation(
    async (tx: any) => {
      if (tx.operations[0].func.value.functionName.toString() === "get_rug")
        return {
          _parsed: true,
          result: {
            retval: nativeToScVal({ ...rugs[0], status: ["Redeemed"] }),
          },
        } as any;
      return {
        _parsed: true,
        latestLedger: 100,
        minResourceFee: "100",
        transactionData: new SorobanDataBuilder(),
        result: { auth: [], retval: nativeToScVal(1n, { type: "i128" }) },
      } as any;
    },
  );
  vi.spyOn(rpc.Server.prototype, "sendTransaction").mockResolvedValue({
    status: "PENDING",
  } as any);
  poll = vi.spyOn(rpc.Server.prototype, "pollTransaction").mockImplementation(
    () =>
      new Promise((r) => {
        complete = r;
      }) as any,
  );
  vi.spyOn(rpc.Server.prototype, "getHealth").mockResolvedValue({
    oldestLedger: 1,
    latestLedger: 100,
  } as any);
  vi.spyOn(rpc.Server.prototype, "getEvents").mockResolvedValue({
    events: [],
    latestLedger: 100,
  } as any);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function renderAndSubmit() {
  await act(async () =>
    root.render(
      <WalletProvider>
        <CoSignPanel initial={encodeHandover(h("1"))} rugs={rugs} events={[]} />
      </WalletProvider>,
    ),
  );
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Sign to close the certificate",
  )!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(poll).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Waiting for the network to confirm");
}
it("confirms the submitted rug in the ordinary case", async () => {
  await renderAndSubmit();
  await act(async () => complete({ status: "SUCCESS" }));
  expect(container.querySelector(".handed-over-title")?.textContent).toContain(
    "No. 0001",
  );
  expect(container.querySelector(".handed-over")?.textContent).toContain(
    "Ayşe the weaver",
  );
  const sentTx = vi.mocked(rpc.Server.prototype.sendTransaction).mock
    .calls[0][0] as any;
  expect(
    container.querySelector(".handed-over a")?.getAttribute("href"),
  ).toContain(Buffer.from(sentTx.hash()).toString("hex"));
});
it("offers replacement and discards an expired stored code", async () => {
  localStorage.setItem(
    handoverKey(1n),
    encodeHandover({ ...h("1"), until: 50 }),
  );
  await act(async () =>
    root.render(
      <WalletProvider>
        <HandoverPanel rug={rugs[0]} holder={ACCOUNTS.weaver} />
      </WalletProvider>,
    ),
  );
  expect(container.textContent).toContain("Sign again");
  expect(container.textContent).toContain("expired");
  expect(localStorage.getItem(handoverKey(1n))).toBeNull();
});
it.each(["Requested", "Locked"] as const)(
  "blocks %s rug without release instruction",
  async (status) => {
    await act(async () =>
      root.render(
        <WalletProvider>
          <CoSignPanel
            initial={encodeHandover(h("1"))}
            rugs={[{ ...rugs[0], status }]}
            events={[]}
          />
        </WalletProvider>,
      ),
    );
    expect(container.textContent).toContain("Keep the rug in the store");
    expect(container.textContent).not.toContain(
      "Sign to close the certificate",
    );
  },
);
it("never instructs release of a different rug if code changes while confirmation is pending", async () => {
  await renderAndSubmit();
  const area = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(area, encodeHandover(h("2", ACCOUNTS.investor)));
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain("Second rug");
  const sent = vi.mocked(rpc.Server.prototype.sendTransaction).mock
    .calls[0][0] as any;
  const sentArgs = sent.operations[0].func.value.args.map(scValToNative);
  expect(sentArgs).toEqual([ACCOUNTS.weaver, 1n]);
  await act(async () => complete({ status: "SUCCESS" }));
  expect(container.querySelector(".handed-over-title")?.textContent).toContain(
    "No. 0001",
  );
  expect(container.querySelector(".handed-over")?.textContent).toContain(
    "Ayşe the weaver",
  );
  const sentTx = vi.mocked(rpc.Server.prototype.sendTransaction).mock
    .calls[0][0] as any;
  expect(
    container.querySelector(".handed-over a")?.getAttribute("href"),
  ).toContain(Buffer.from(sentTx.hash()).toString("hex"));
});
it("keeps a matching wallet read-only in judge preview", async () => {
  window.history.replaceState(null, "", "/?as=store");
  try {
    await act(async () =>
      root.render(
        <WalletProvider>
          <CoSignPanel
            initial={encodeHandover(h("1"))}
            rugs={rugs}
            events={[]}
          />
        </WalletProvider>,
      ),
    );
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Sign to close the certificate",
    )!;
    expect(button.disabled).toBe(true);
    expect(container.textContent).toContain("Leave preview");
    expect(rpc.Server.prototype.sendTransaction).not.toHaveBeenCalled();
  } finally {
    window.history.replaceState(null, "", "/");
  }
});
