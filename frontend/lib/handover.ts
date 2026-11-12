// Rug hand-over (contract `redeem`): needs the holder's and the store's
// signatures. The holder signs their auth entry here and gets a link/code.
// The store opens it, signs the transaction envelope and submits it.
// When the store itself holds the rug (after a buy-out) one signature does it.
import {
  Account,
  Address,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { CONTRACT_ID, NETWORK_PASSPHRASE } from "./deployment";
import { AppError, explainError } from "./errors";
import { addr, server, u64 } from "./contract";
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
};

/** ~24 hours of 5-second ledgers. */
const VALID_LEDGERS = 17_280;

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

export function decodeHandover(code: string): Handover {
  try {
    const b64 = code.trim().replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const h = JSON.parse(new TextDecoder().decode(bytes)) as Handover;
    if (h.v !== 1 || !h.rug || !h.holder || !h.store || !Array.isArray(h.auth)) throw new Error();
    return h;
  } catch {
    throw new AppError("This hand-over code isn't valid. Ask the holder to send the link again.");
  }
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
  const latest = await server().getLatestLedger();
  const until = latest.sequence + VALID_LEDGERS;
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
  return { v: 1, rug: rugId.toString(), holder, store, auth, until };
}

/** Store side: co-sign and submit a holder's hand-over. */
export async function submitHandover(h: Handover, onStep?: (s: TxStep) => void): Promise<TxResult> {
  const latest = await server().getLatestLedger();
  if (latest.sequence > h.until) throw new AppError("This hand-over code has expired. Ask the holder to sign again.");
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
