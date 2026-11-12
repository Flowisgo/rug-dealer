// Rug hand-over (contract `redeem`): needs the holder's and the store's
// signatures. The holder signs their auth entry here and gets a link/code.
// The store opens it, signs the transaction envelope and submits it.
// When the store itself holds the rug (after a buy-out) one signature does it.
import {
  Account,
  Address,
  BASE_FEE,
  Operation,
  StrKey,
  TransactionBuilder,
  authorizeEntry,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { CONTRACT_ID, NETWORK_PASSPHRASE } from "./deployment";
import { AppError, explainError } from "./errors";
import { addr, server, u64, type Rug } from "./contract";
import { invoke, type TxResult, type TxStep } from "./tx";
import { assertSigner, signAuth } from "./wallet";

export type Handover = {
  v: 1;
  rug: string; // rug id as decimal string
  holder: string;
  store: string;
  /** All auth entries for the call, base64 XDR; the holder's is signed. */
  auth: string[];
  /** Last ledger the holder's signature is valid for. */
  until: number;
  /** The RugDealer contract the code was signed for. Codes from before this
   * field existed belong to an earlier deployment. */
  contract?: string;
};

/** ~24 hours of 5-second ledgers. */
const VALID_LEDGERS = 17_280;

/** Where the holder's signed code is kept between page loads. Scoped to the
 * contract, because rug numbers restart when the contract is redeployed. */
export const handoverKey = (rugId: bigint | string) => `rugdealer:${CONTRACT_ID}:handover:${rugId}`;

export type HandoverCheck =
  | "old-contract" // signed for an earlier deployment of the contract
  | "unknown-rug" // no such rug (yet) in this deployment
  | "wrong-store" // the code names another store than the rug's
  | "handed-over" // the rug is already Redeemed: nothing more to do
  | "not-holder" // the code's holder no longer holds the rug
  | "pledged" // the rug backs a loan request or a running loan: it must stay in the store
  | "expired" // the holder's signature has run out; they must sign again
  | "ready"; // the rug is free and the signature is live: the store can sign

/** True once the ledger has passed the last one the holder's signature covers. */
export const isExpired = (h: Pick<Handover, "until">, latestLedger: number) => latestLedger > h.until;

/**
 * What the store should see for a hand-over code, given the rug's current
 * record and, when known, the latest ledger. Only a free rug with a live
 * signature is "ready": the contract refuses anything else, and the store
 * must never be told to release a rug that is pledged for a loan.
 */
export function checkHandover(h: Handover, rug: Rug | undefined, latestLedger?: number): HandoverCheck {
  if (h.contract !== CONTRACT_ID) return "old-contract";
  if (!rug) return "unknown-rug";
  if (rug.store !== h.store) return "wrong-store";
  if (rug.status === "Redeemed") return "handed-over";
  if (rug.owner !== h.holder) return "not-holder";
  if (rug.status !== "Free") return "pledged";
  if (latestLedger !== undefined && isExpired(h, latestLedger)) return "expired";
  return "ready";
}

type KeyStore = Pick<Storage, "getItem" | "removeItem">;
const browserStorage = (): KeyStore | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** Drop saved hand-over codes for rugs that have been handed over.
 * Returns the ids it cleared. */
export function forgetHandedOver(rugs: Rug[], storage: KeyStore | null = browserStorage()): bigint[] {
  if (!storage) return [];
  const cleared: bigint[] = [];
  for (const r of rugs) {
    if (r.status !== "Redeemed") continue;
    try {
      if (storage.getItem(handoverKey(r.id)) !== null) {
        storage.removeItem(handoverKey(r.id));
        cleared.push(r.id);
      }
    } catch {}
  }
  return cleared;
}

export function entryAddress(e: xdr.SorobanAuthorizationEntry): string | null {
  const c = e.credentials as unknown as { type: string; address?: { address: unknown }; addressV2?: { address: unknown } };
  const inner = c.type === "sorobanCredentialsAddress" ? c.address : c.type === "sorobanCredentialsAddressV2" ? c.addressV2 : null;
  return inner ? Address.fromScAddress(inner.address as xdr.ScAddress).toString() : null;
}

const redeemArgs = (holder: string, rugId: bigint) => [addr(holder), u64(rugId)];

export function encodeHandover(h: Handover): string {
  const json = JSON.stringify(h);
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Every field is checked here, so nothing downstream can trip over a bad code. */
function validHandover(x: unknown): x is Handover {
  if (!x || typeof x !== "object") return false;
  const h = x as Record<string, unknown>;
  if (h.v !== 1) return false;
  if (typeof h.rug !== "string" || !/^[1-9]\d{0,19}$/.test(h.rug) || BigInt(h.rug) > 18446744073709551615n) return false;
  if (typeof h.holder !== "string" || !StrKey.isValidEd25519PublicKey(h.holder)) return false;
  if (typeof h.store !== "string" || !StrKey.isValidEd25519PublicKey(h.store)) return false;
  if (typeof h.until !== "number" || !Number.isInteger(h.until) || h.until <= 0) return false;
  if (h.contract !== undefined && typeof h.contract !== "string") return false;
  if (!Array.isArray(h.auth) || h.auth.length === 0 || h.auth.length > 8) return false;
  return h.auth.every((a) => {
    if (typeof a !== "string") return false;
    try {
      xdr.SorobanAuthorizationEntry.fromXDR(a, "base64");
      return true;
    } catch {
      return false;
    }
  });
}

export function decodeHandover(code: string): Handover {
  let parsed: unknown;
  try {
    const b64 = code.trim().replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    parsed = null;
  }
  if (!validHandover(parsed)) throw new AppError("This hand-over code isn't valid. Ask the holder to send the link again.");
  return parsed;
}

/** The latest ledger, for checking whether a hand-over signature is still live. */
export async function latestLedger(): Promise<number> {
  return (await server().getLatestLedger()).sequence;
}

/** Holder side: sign the holder's part of the hand-over. */
export async function signHandover(holder: string, rugId: bigint, store: string): Promise<Handover> {
  await assertSigner(holder);
  // Simulate with the store as transaction source: the store then authorises
  // as the source account and only the holder needs a separate signature.
  const tx = new TransactionBuilder(new Account(store, "0"), { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({ contract: CONTRACT_ID, function: "redeem", args: redeemArgs(holder, rugId), auth: [] }))
    .setTimeout(60)
    .build();
  const sim = await server().simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw explainError(sim.error);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw explainError("");
  const until = (await latestLedger()) + VALID_LEDGERS;
  const auth: string[] = [];
  let signed = false;
  for (const entry of sim.result.auth) {
    if (entryAddress(entry) === holder) {
      const done = await authorizeEntry(
        entry,
        async (preimage) => signAuth(preimage.toXDR("base64"), holder),
        until,
        NETWORK_PASSPHRASE,
      );
      auth.push(done.toXDR("base64"));
      signed = true;
    } else {
      auth.push(entry.toXDR("base64"));
    }
  }
  if (!signed) throw new AppError("The network didn't ask for the holder's signature. Refresh and try again.");
  return { v: 1, rug: rugId.toString(), holder, store, auth, until, contract: CONTRACT_ID };
}

/** Store side: co-sign and submit a holder's hand-over. */
export async function submitHandover(h: Handover, onStep?: (s: TxStep) => void): Promise<TxResult> {
  if (isExpired(h, await latestLedger())) throw new AppError("This hand-over code has expired. Ask the holder to sign again.");
  return invoke(
    {
      source: h.store,
      method: "redeem",
      args: redeemArgs(h.holder, BigInt(h.rug)),
      auth: h.auth.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, "base64")),
      label: `Hand over rug ${h.rug}`,
    },
    onStep,
  );
}

/** The store holds the rug itself (after a buy-out): one signature. */
export function redeemOwnRug(store: string, rugId: bigint, onStep?: (s: TxStep) => void): Promise<TxResult> {
  return invoke({ source: store, method: "redeem", args: redeemArgs(store, rugId), label: `Hand over rug ${rugId}` }, onStep);
}
