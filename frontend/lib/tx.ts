// The transaction pipeline:
// build -> simulate (restore archived data if needed) -> assemble -> Freighter
// sign -> send -> poll. The pending hash is kept in localStorage so a refresh
// mid-flight can pick it up again.
import {
  Asset,
  BASE_FEE,
  Operation,
  Transaction,
  TransactionBuilder,
  rpc,
  scValToNative,
  type xdr,
} from "@stellar/stellar-sdk";
import { CONTRACT_ID, NETWORK_PASSPHRASE, USDC_CODE, USDC_ISSUER } from "./deployment";
import { AppError, explainError } from "./errors";
import { server } from "./contract";
import { assertSigner, signTx } from "./wallet";

export type TxStep = "checking" | "restoring" | "signing" | "sending" | "confirming";
export const STEP_TEXT: Record<TxStep, string> = {
  checking: "Checking with the network…",
  restoring: "Restoring old records first. Sign once in Freighter…",
  signing: "Review and sign in Freighter…",
  sending: "Sending…",
  confirming: "Waiting for the network to confirm…",
};

/** JSON that survives BigInt and XDR objects, for error text only. */
const safeJson = (v: unknown) => {
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  } catch {
    return String(v);
  }
};

export type Pending = { hash: string; label: string; source: string; at: number };
export type TxResult = { hash: string; value: unknown };

const PENDING_KEY = `rugdealer:${CONTRACT_ID}:pending`;

export function loadPending(): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || "null") as Pending | null;
    return p && /^[0-9a-f]{64}$/.test(p.hash) ? p : null;
  } catch {
    return null;
  }
}
function savePending(p: Pending) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {}
}
export function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {}
}

/** Poll a sent transaction until it succeeds, fails, or we give up. */
export async function waitFor(hash: string, attempts = 30): Promise<rpc.Api.GetTransactionResponse> {
  const res = await server().pollTransaction(hash, {
    attempts,
    sleepStrategy: () => 2000,
  });
  return res;
}

/** Look up a pending transaction left by an earlier page load. */
export async function resumePending(): Promise<{ pending: Pending; status: "SUCCESS" | "FAILED" | "NOT_FOUND" } | null> {
  const p = loadPending();
  if (!p) return null;
  const r = await server().getTransaction(p.hash);
  if (r.status !== "NOT_FOUND" || Date.now() - p.at > 5 * 60_000) clearPending();
  return { pending: p, status: r.status as "SUCCESS" | "FAILED" | "NOT_FOUND" };
}

async function signSendConfirm(tx: Transaction, source: string, label: string, onStep: (s: TxStep) => void): Promise<TxResult> {
  onStep("signing");
  await assertSigner(source);
  const signedXdr = await signTx(tx.toXDR(), source);
  const signed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE) as Transaction;
  const hex = (u: Uint8Array) => Array.from(u, (x) => x.toString(16).padStart(2, "0")).join("");
  const hash = hex(signed.hash());
  if (hash !== hex(tx.hash())) throw new AppError("The signed transaction differs from the one you reviewed. Nothing was sent.", undefined, "wallet");

  onStep("sending");
  savePending({ hash, label, source, at: Date.now() });
  const sent = await server().sendTransaction(signed);
  if (sent.status === "ERROR") {
    clearPending();
    throw explainError(safeJson(sent.errorResult ?? sent));
  }
  onStep("confirming");
  const res = await waitFor(hash);
  if (res.status === "SUCCESS") {
    clearPending();
    const ret = res.returnValue;
    return { hash, value: ret ? scValToNative(ret) : undefined };
  }
  if (res.status === "FAILED") {
    clearPending();
    throw new AppError("The network ran the transaction but it failed, so nothing changed. Refresh and try again.", undefined, "network");
  }
  throw new AppError("Sent, but the network hasn't confirmed it yet. Refresh in a minute to see if it went through.", undefined, "network");
}

/** Restore archived contract data named by a simulation's restore preamble. */
async function restore(source: string, sim: rpc.Api.SimulateTransactionRestoreResponse, onStep: (s: TxStep) => void) {
  onStep("restoring");
  const account = await server().getAccount(source);
  const fee = (BigInt(BASE_FEE) + BigInt(sim.restorePreamble.minResourceFee)).toString();
  const tx = new TransactionBuilder(account, { fee, networkPassphrase: NETWORK_PASSPHRASE })
    .setSorobanData(sim.restorePreamble.transactionData.build())
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(120)
    .build();
  await signSendConfirm(tx, source, "Restore archived records", () => {});
}

export type ContractCall = {
  source: string;
  method: string;
  args: xdr.ScVal[];
  /** Pre-signed auth entries (co-signed hand-over). Simulation then runs in
   * enforcing mode and keeps them. */
  auth?: xdr.SorobanAuthorizationEntry[];
  label: string;
};

/** Run one contract call signed by `source`. Always simulates first. */
export async function invoke(call: ContractCall, onStep: (s: TxStep) => void = () => {}): Promise<TxResult> {
  onStep("checking");
  if (loadPending()) {
    const r = await resumePending();
    if (r && r.status === "NOT_FOUND")
      throw new AppError("An earlier transaction is still waiting for the network. Give it a minute, then refresh.", undefined, "network");
  }
  await assertSigner(call.source);

  for (let attempt = 0; attempt < 2; attempt++) {
    const account = await server().getAccount(call.source).catch(() => {
      throw new AppError("This account doesn't exist on testnet yet. Fund it with test XLM first.", undefined, "network");
    });
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(
        Operation.invokeContractFunction({ contract: CONTRACT_ID, function: call.method, args: call.args, auth: call.auth ?? [] }),
      )
      .setTimeout(180)
      .build();
    const sim = await server().simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw explainError(sim.error);
    if (rpc.Api.isSimulationRestore(sim)) {
      await restore(call.source, sim, onStep);
      continue;
    }
    const prepared = rpc.assembleTransaction(tx, sim).build();
    return signSendConfirm(prepared, call.source, call.label, onStep);
  }
  throw new AppError("Couldn't restore the archived records. Try again.", undefined, "network");
}

/** Add a USDC trustline so the wallet can hold test USDC. */
export async function addUsdcTrustline(source: string, onStep: (s: TxStep) => void = () => {}): Promise<TxResult> {
  onStep("checking");
  await assertSigner(source);
  const account = await server().getAccount(source);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: new Asset(USDC_CODE, USDC_ISSUER) }))
    .setTimeout(180)
    .build();
  return signSendConfirm(tx, source, "Add USDC to wallet", onStep);
}
