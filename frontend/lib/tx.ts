// The transaction pipeline:
// build -> simulate (restore archived data if needed) -> assemble -> Varial
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
  restoring: "Restoring old records first. Sign once in Varial…",
  signing: "Review and sign in Varial…",
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

// Sent-but-unconfirmed transactions, kept across reloads. A list keyed by
// transaction hash: two actions (e.g. in two tabs) never overwrite each
// other, and confirming one never clears another.
const PENDING_KEY = `rugdealer:${CONTRACT_ID}:pending-list`;
/** The single-slot record earlier versions kept; read once and folded in. */
const LEGACY_KEY = `rugdealer:${CONTRACT_ID}:pending`;

const isPending = (p: unknown): p is Pending =>
  !!p && typeof p === "object" && /^[0-9a-f]{64}$/.test(String((p as Pending).hash)) && typeof (p as Pending).at === "number";

/** Pure: the list with `p` added (replacing any record with the same hash). */
export const withPending = (list: Pending[], p: Pending): Pending[] => [...list.filter((x) => x.hash !== p.hash), p];
/** Pure: the list without the record for `hash`. */
export const withoutPending = (list: Pending[], hash: string): Pending[] => list.filter((x) => x.hash !== hash);

export function loadPendingList(): Pending[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]") as unknown;
    let list = Array.isArray(raw) ? raw.filter(isPending) : [];
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null") as unknown;
    if (isPending(legacy)) list = withPending(list, legacy);
    if (legacy !== null) localStorage.removeItem(LEGACY_KEY);
    return list;
  } catch {
    return [];
  }
}
function writePendingList(list: Pending[]) {
  try {
    if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    else localStorage.removeItem(PENDING_KEY);
  } catch {}
}
function savePending(p: Pending) {
  writePendingList(withPending(loadPendingList(), p));
}
export function clearPending(hash: string) {
  writePendingList(withoutPending(loadPendingList(), hash));
}

// One action at a time in this tab: a second one started while the first is
// still being signed or confirmed is refused instead of racing it.
let inFlight: string | null = null;

/** Run `fn` unless another action is already in progress in this tab. */
export async function runExclusive<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (inFlight)
    throw new AppError(`Finish "${inFlight}" first. One action at a time, so nothing gets lost.`, undefined, "wallet");
  inFlight = label;
  try {
    return await fn();
  } finally {
    inFlight = null;
  }
}

/** Poll a sent transaction until it succeeds, fails, or we give up. */
export async function waitFor(hash: string, attempts = 30): Promise<rpc.Api.GetTransactionResponse> {
  const res = await server().pollTransaction(hash, {
    attempts,
    sleepStrategy: () => 2000,
  });
  return res;
}

/** Transactions are built to expire after this; one not found well past it never landed. */
const TX_TIMEOUT_SECONDS = 180;
const EXPIRED_AFTER_MS = (TX_TIMEOUT_SECONDS + 60) * 1000;

export type PendingStatus = "SUCCESS" | "FAILED" | "NOT_FOUND" | "EXPIRED";

/** What a saved pending transaction means now, from the network's answer and
 * its age. "NOT_FOUND" is the only status that should block a new action. */
export function pendingOutcome(networkStatus: string, ageMs: number): { status: PendingStatus; clear: boolean } {
  if (networkStatus === "SUCCESS" || networkStatus === "FAILED") return { status: networkStatus, clear: true };
  if (ageMs > EXPIRED_AFTER_MS) return { status: "EXPIRED", clear: true };
  return { status: "NOT_FOUND", clear: false };
}

/** Look up every pending transaction left by an earlier page load (or another
 * tab). Records that landed, failed or expired are cleared, each by its hash. */
export async function resumePending(): Promise<{ pending: Pending; status: PendingStatus }[]> {
  const out: { pending: Pending; status: PendingStatus }[] = [];
  for (const p of loadPendingList()) {
    const r = await server().getTransaction(p.hash);
    const o = pendingOutcome(r.status, Date.now() - p.at);
    if (o.clear) clearPending(p.hash);
    out.push({ pending: p, status: o.status });
  }
  return out;
}

/** Refuse to start a new transaction while an earlier one may still land. */
async function ensureNothingPending() {
  if (loadPendingList().length === 0) return;
  const waiting = (await resumePending()).filter((r) => r.status === "NOT_FOUND");
  if (waiting.length)
    throw new AppError(
      `"${waiting[0].pending.label}" is still waiting for the network. Give it a minute, then refresh.`,
      undefined,
      "network",
    );
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
    clearPending(hash);
    throw explainError(safeJson(sent.errorResult ?? sent));
  }
  onStep("confirming");
  const res = await waitFor(hash);
  if (res.status === "SUCCESS") {
    clearPending(hash);
    const ret = res.returnValue;
    return { hash, value: ret ? scValToNative(ret) : undefined };
  }
  if (res.status === "FAILED") {
    clearPending(hash);
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
export function invoke(call: ContractCall, onStep: (s: TxStep) => void = () => {}): Promise<TxResult> {
  return runExclusive(call.label, () => invokeNow(call, onStep));
}

async function invokeNow(call: ContractCall, onStep: (s: TxStep) => void): Promise<TxResult> {
  onStep("checking");
  await ensureNothingPending();
  await assertSigner(call.source);

  for (let attempt = 0; attempt < 2; attempt++) {
    const account = await server().getAccount(call.source).catch(() => {
      throw new AppError("This account doesn't exist on testnet yet. Fund it with test XLM first.", undefined, "network");
    });
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(
        Operation.invokeContractFunction({ contract: CONTRACT_ID, function: call.method, args: call.args, auth: call.auth ?? [] }),
      )
      .setTimeout(TX_TIMEOUT_SECONDS)
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
export function addUsdcTrustline(source: string, onStep: (s: TxStep) => void = () => {}): Promise<TxResult> {
  return runExclusive("Add USDC to wallet", () => addUsdcTrustlineNow(source, onStep));
}

async function addUsdcTrustlineNow(source: string, onStep: (s: TxStep) => void): Promise<TxResult> {
  onStep("checking");
  await ensureNothingPending();
  await assertSigner(source);
  const account = await server().getAccount(source);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: new Asset(USDC_CODE, USDC_ISSUER) }))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
  return signSendConfirm(tx, source, "Add USDC to wallet", onStep);
}
