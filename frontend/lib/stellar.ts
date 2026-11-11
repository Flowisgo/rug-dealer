import { receiptBytes, parseAmount, units } from "./encoding";
import type { Terms } from "./encoding";
export type { Terms } from "./encoding";
export {
  receiptBytes,
  parseAmount,
  units,
  termsValue,
  newReceiptId,
} from "./encoding";
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import {
  getAddress,
  getNetworkDetails,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import deployment from "../demo/deployment.json" with { type: "json" };
export { deployment };
export const CONTRACT = deployment.contract;
export const USDC = deployment.usdc;
export const DEMO_RECEIPT =
  (deployment.receipts as { id: string }[])[0]?.id || "";
export const ROLES = [
  "warehouse",
  "weaver",
  "dealer",
  "lender",
  "buyer",
] as const;
export type Role = (typeof ROLES)[number];
export type Defaults = Omit<Terms, "lender" | "dealer">;
export type Receipt = {
  weaver: string;
  terms: Terms | null;
  dealer_committed: boolean;
  buyer: string | null;
  pickup_recipient: string | null;
  approved_price: bigint | null;
  funded_at: bigint | null;
  deadline: bigint | null;
  stage: string;
  ready_for_pickup: boolean;
};
export type ActionRecord = {
  hash: string;
  action: string;
  status: "pending" | "confirmed" | "failed" | "expired";
  validUntil: number;
};
export type RugMeta = {
  id: string;
  name: string;
  description: string;
  scenario?: string;
};
const server = new rpc.Server("https://soroban-testnet.stellar.org");
const hex = (v: Uint8Array) =>
  Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("");
export const txLink = (hash: string) =>
  `https://stellar.expert/explorer/testnet/tx/${hash}`;
export const storageKey = (id: string) => `${CONTRACT}:${id}:full-demo-action`;
export const registryKey = `${CONTRACT}:rug-metadata`;
const businessErrors: Record<string, string> = {
  "1": "This receipt already exists. Use its existing record or generate a new ID.",
  "2": "Receipt not found in this deployment. Register it or load another receipt.",
  "3": "This action is unavailable at the current loan stage. Refresh the receipt.",
  "4": "The weaver must approve a sale price first.",
  "5": "The amounts must be valid and cover lender repayment plus custody.",
  "6": "The dealer must accept the exact weaver-approved terms.",
  "7": "The deadline has arrived. Use repayment or the committed dealer purchase.",
  "8": "Dealer purchase is available only after the ledger deadline.",
  "9": "The nominated dealer must accept the fallback commitment before funding.",
  "10": "Choose a loan duration from 30 seconds to one day.",
};
function simulationMessage(error: string) {
  const code = error.match(/Contract,\s*#?(\d+)/)?.[1];
  return code && businessErrors[code]
    ? businessErrors[code]
    : "The contract rejected this action. Refresh the receipt and check the signing wallet, terms, balance, and trustline.";
}
async function view(
  method: string,
  args: xdr.ScVal[] = [],
  contract = CONTRACT,
) {
  if (!contract)
    throw new Error("The full-demo deployment is not configured yet.");
  const tx = new TransactionBuilder(
    new Account(deployment.accounts.warehouse, "0"),
    { fee: BASE_FEE, networkPassphrase: Networks.TESTNET },
  )
    .addOperation(new Contract(contract).call(method, ...args))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result)
    throw new Error(simulationMessage("error" in sim ? String(sim.error) : ""));
  return scValToNative(sim.result.retval);
}
export async function readReceipt(id: string): Promise<Receipt> {
  const r = await view("get_receipt", [receiptBytes(id)]);
  return {
    ...r,
    terms:
      Array.isArray(r.terms) && r.terms[0] === "Accepted" ? r.terms[1] : null,
    stage: Array.isArray(r.stage) ? r.stage[0] : r.stage,
  };
}
export const readDefaults = async (): Promise<Defaults> => view("loan_terms");
export const ledgerTime = async (): Promise<bigint> => view("ledger_time");
export async function walletInfo(address: string) {
  const response = await fetch(
    `https://horizon-testnet.stellar.org/accounts/${address}`,
    { cache: "no-store" },
  );
  if (response.status === 404)
    return { funded: false, trustline: false, balance: 0n, xlm: "0" };
  if (!response.ok)
    throw new Error("Could not read wallet funding. Try refreshing.");
  const account = await response.json();
  const line = account.balances.find(
    (b: { asset_code?: string; asset_issuer?: string }) =>
      b.asset_code === "USDC" && b.asset_issuer === deployment.issuer,
  );
  return {
    funded: true,
    trustline: !!line && line.is_authorized,
    balance: line ? parseAmount(line.balance) : 0n,
    xlm: account.balances.find(
      (b: { asset_type: string }) => b.asset_type === "native",
    ).balance,
  };
}
export async function verifyWallet(expected?: string) {
  const network = await getNetworkDetails();
  if (network.error) throw new Error(network.error.message);
  if (network.networkPassphrase !== Networks.TESTNET)
    throw new Error(
      "Switch Varial / Freighter to Testnet, then reconnect. Mainnet is never used.",
    );
  const wallet = await getAddress();
  if (wallet.error || !wallet.address)
    throw new Error("Unlock and connect Varial / Freighter.");
  if (expected && wallet.address !== expected)
    throw new Error(
      `Switch your wallet to ${expected}, then reconnect. This action needs that wallet’s signature.`,
    );
  return wallet.address;
}
export async function connectWallet() {
  if (!(await isConnected()).isConnected)
    throw new Error(
      "Varial / Freighter is unavailable in this browser. Open the page in Chrome with the wallet extension installed.",
    );
  const access = await requestAccess();
  if (access.error || !access.address)
    throw new Error(access.error?.message || "Wallet connection was declined.");
  return verifyWallet(access.address);
}
export async function restoreWallet() {
  try {
    const w = await getAddress();
    return w.address ? await verifyWallet(w.address) : "";
  } catch {
    return "";
  }
}
export function storedAction(id: string): ActionRecord | null {
  try {
    const r = JSON.parse(localStorage.getItem(storageKey(id)) || "null");
    return r &&
      /^[a-f0-9]{64}$/.test(r.hash) &&
      ["pending", "confirmed", "failed", "expired"].includes(r.status)
      ? r
      : null;
  } catch {
    return null;
  }
}
function persist(
  id: string,
  r: ActionRecord,
  notify: (r: ActionRecord) => void,
) {
  localStorage.setItem(storageKey(id), JSON.stringify(r));
  notify(r);
}
async function signAndSubmit(
  id: string,
  action: string,
  address: string,
  op: ReturnType<Contract["call"]> | ReturnType<typeof Operation.changeTrust>,
  notice: (s: string) => void,
  notify: (r: ActionRecord) => void,
) {
  await verifyWallet(address);
  if (storedAction(id)?.status === "pending")
    throw new Error(
      "A transaction for this receipt is still pending. Refresh its status before another action.",
    );
  const account = await server.getAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();
  let prepared: Transaction = tx;
  if (action !== "trustline") {
    const sim = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim))
      throw new Error(
        simulationMessage("error" in sim ? String(sim.error) : ""),
      );
    prepared = rpc.assembleTransaction(tx, sim).build();
  }
  await verifyWallet(address);
  notice("Review and sign in Varial / Freighter…");
  const signed = await signTransaction(prepared.toXDR(), {
    networkPassphrase: Networks.TESTNET,
    address,
  });
  if (signed.error || !signed.signedTxXdr)
    throw new Error(
      signed.error?.message || "Signature rejected. Nothing was submitted.",
    );
  if (signed.signerAddress !== address)
    throw new Error("The signing wallet changed. Reconnect and review again.");
  const decoded = TransactionBuilder.fromXDR(
    signed.signedTxXdr,
    Networks.TESTNET,
  );
  if (
    !(decoded instanceof Transaction) ||
    hex(decoded.hash()) !== hex(prepared.hash())
  )
    throw new Error("The signed transaction differs from the reviewed action.");
  let record: ActionRecord = {
    hash: hex(decoded.hash()),
    action,
    status: "pending",
    validUntil: Number(decoded.timeBounds?.maxTime || 0),
  };
  persist(id, record, notify);
  notice("Submitted. Waiting for network confirmation…");
  const response = await server.sendTransaction(decoded);
  if (response.status === "ERROR") {
    record = { ...record, status: "failed" };
    persist(id, record, notify);
    throw new Error(
      "The network rejected the transaction. No successful action was recorded. Refresh and review before retrying.",
    );
  }
  return record;
}
export async function contractAction(
  id: string,
  method: string,
  address: string,
  args: xdr.ScVal[],
  expected: string,
  cost: bigint,
  notice: (s: string) => void,
  notify: (r: ActionRecord) => void,
) {
  await verifyWallet(expected);
  if (address !== expected)
    throw new Error("Reconnect the nominated wallet before this action.");
  const wallet = await walletInfo(address);
  if (!wallet.funded)
    throw new Error(
      "This wallet needs test XLM. Use the testnet faucet below.",
    );
  if (cost > 0n && (!wallet.trustline || wallet.balance < cost))
    throw new Error(
      `This wallet needs a Circle testnet USDC trustline and ${units(cost)} test USDC. Use the wallet setup controls below.`,
    );
  return signAndSubmit(
    id,
    method,
    address,
    new Contract(CONTRACT).call(method, receiptBytes(id), ...args),
    notice,
    notify,
  );
}
export const amountValue = (n: bigint) => nativeToScVal(n, { type: "i128" });
export const addressValue = (a: string) => new Address(a).toScVal();
export async function addTrustline(
  id: string,
  address: string,
  notice: (s: string) => void,
  notify: (r: ActionRecord) => void,
) {
  return signAndSubmit(
    id,
    "trustline",
    address,
    Operation.changeTrust({
      asset: new Asset("USDC", deployment.issuer),
      limit: "1000",
    }),
    notice,
    notify,
  );
}
export async function awaitConfirmation(
  record: ActionRecord,
): Promise<ActionRecord> {
  for (let i = 0; i < 20; i++) {
    const r = await server.getTransaction(record.hash);
    if (r.status === "SUCCESS") return { ...record, status: "confirmed" };
    if (r.status === "FAILED") return { ...record, status: "failed" };
    if (
      r.status === "NOT_FOUND" &&
      record.validUntil > 0 &&
      Date.now() / 1000 > record.validUntil + 30
    )
      return { ...record, status: "expired" };
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return record;
}
