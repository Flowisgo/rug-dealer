// Contract events -> plain-language sentences for the activity feed and the
// rug timeline.
import { scValToNative, type xdr } from "@stellar/stellar-sdk";
import { CONTRACT_ID, DEPLOY_LEDGER } from "./deployment";
import { server, variant } from "./contract";

export type EventMeta = { id: string; ledger: number; at: string; txHash: string };

export type AppEvent = EventMeta &
  (
    | { kind: "store_registered"; store: string; limit: bigint }
    | { kind: "store_limit_set"; store: string; limit: bigint }
    | { kind: "store_frozen"; store: string; reason: "Platform" | "MissedBuyout" }
    | { kind: "rug_minted"; rugId: bigint; store: string; weaver: string; description: string; price: bigint }
    | { kind: "loan_requested"; loanId: bigint; rugId: bigint; store: string; weaver: string; principal: bigint; months: number }
    | { kind: "loan_cancelled"; loanId: bigint; rugId: bigint; weaver: string }
    | {
        kind: "loan_funded";
        loanId: bigint;
        rugId: bigint;
        investor: string;
        principal: bigint;
        interest: bigint;
        platformFee: bigint;
        storeFee: bigint;
        weaverPayout: bigint;
        endAt: bigint;
      }
    | { kind: "loan_repaid"; loanId: bigint; rugId: bigint; weaver: string; investor: string; principal: bigint; interest: bigint }
    | { kind: "store_bought_out"; loanId: bigint; rugId: bigint; store: string; investor: string; principal: bigint; interest: bigint }
    | { kind: "rug_claimed"; loanId: bigint; rugId: bigint; investor: string; store: string; interest: bigint }
    | { kind: "rug_redeemed"; rugId: bigint; store: string; holder: string }
    | { kind: "unknown"; name: string }
  );

type D = Record<string, unknown>;
const b = (v: unknown) => BigInt(v as bigint);
const s = (v: unknown) => String(v);

/** Decode an event from already-native topics and data (scValToNative output). */
export function decodeNative(topics: unknown[], data: unknown, meta: EventMeta): AppEvent {
  const name = String(topics[0]);
  const t1 = topics[1];
  const d = (data ?? {}) as D;
  switch (name) {
    case "store_registered":
    case "store_limit_set":
      return { ...meta, kind: name, store: s(t1), limit: b(d.limit) };
    case "store_frozen":
      return { ...meta, kind: name, store: s(t1), reason: variant(d.reason) };
    case "rug_minted":
      return { ...meta, kind: name, rugId: b(t1), store: s(d.store), weaver: s(d.weaver), description: s(d.description), price: b(d.price) };
    case "loan_requested":
      return { ...meta, kind: name, loanId: b(t1), rugId: b(d.rug_id), store: s(d.store), weaver: s(d.weaver), principal: b(d.principal), months: Number(d.months) };
    case "loan_cancelled":
      return { ...meta, kind: name, loanId: b(t1), rugId: b(d.rug_id), weaver: s(d.weaver) };
    case "loan_funded":
      return {
        ...meta,
        kind: name,
        loanId: b(t1),
        rugId: b(d.rug_id),
        investor: s(d.investor),
        principal: b(d.principal),
        interest: b(d.interest),
        platformFee: b(d.platform_fee),
        storeFee: b(d.store_fee),
        weaverPayout: b(d.weaver_payout),
        endAt: b(d.end_at),
      };
    case "loan_repaid":
      return { ...meta, kind: name, loanId: b(t1), rugId: b(d.rug_id), weaver: s(d.weaver), investor: s(d.investor), principal: b(d.principal), interest: b(d.interest) };
    case "store_bought_out":
      return { ...meta, kind: name, loanId: b(t1), rugId: b(d.rug_id), store: s(d.store), investor: s(d.investor), principal: b(d.principal), interest: b(d.interest) };
    case "rug_claimed":
      return { ...meta, kind: name, loanId: b(t1), rugId: b(d.rug_id), investor: s(d.investor), store: s(d.store), interest: b(d.interest) };
    case "rug_redeemed":
      return { ...meta, kind: name, rugId: b(t1), store: s(d.store), holder: s(d.holder) };
    default:
      return { ...meta, kind: "unknown", name };
  }
}

/** Decode a raw RPC event (ScVal topics and value). */
export function decodeEvent(topic: xdr.ScVal[], value: xdr.ScVal, meta: EventMeta): AppEvent {
  return decodeNative(topic.map((t) => scValToNative(t)), scValToNative(value), meta);
}

/** Pieces of a sentence: plain text, an amount, a party, or a rug number. */
export type Part = string | { amount: bigint } | { party: string } | { rug: bigint };

/** One plain sentence per event. */
export function describe(e: AppEvent): Part[] {
  const amt = (amount: bigint) => ({ amount });
  const who = (party: string) => ({ party });
  const rug = (id: bigint) => ({ rug: id });
  switch (e.kind) {
    case "store_registered":
      return ["The platform approved ", who(e.store), " as a store, with a limit of ", amt(e.limit), "."];
    case "store_limit_set":
      return ["The platform set the limit for ", who(e.store), " to ", amt(e.limit), "."];
    case "store_frozen":
      return e.reason === "MissedBuyout"
        ? [who(e.store), " was frozen for missing a buy-out. It can no longer issue rug certificates."]
        : ["The platform froze ", who(e.store), ". It can no longer issue rug certificates."];
    case "rug_minted":
      return [who(e.store), " took in rug ", rug(e.rugId), " from ", who(e.weaver), " and priced it at ", amt(e.price), "."];
    case "loan_requested":
      return [who(e.weaver), " asked to borrow ", amt(e.principal), " against rug ", rug(e.rugId), ` for ${e.months} ${e.months === 1 ? "month" : "months"}.`];
    case "loan_cancelled":
      return [who(e.weaver), " cancelled the loan request on rug ", rug(e.rugId), "."];
    case "loan_funded":
      return [who(e.investor), " lent ", amt(e.principal), " on rug ", rug(e.rugId), ". The weaver received ", amt(e.weaverPayout), "."];
    case "loan_repaid":
      return [who(e.weaver), " repaid ", amt(e.principal), " on rug ", rug(e.rugId), ". ", who(e.investor), " got back ", amt(e.principal + e.interest), "."];
    case "store_bought_out":
      return [who(e.store), " bought rug ", rug(e.rugId), " for ", amt(e.principal), ". ", who(e.investor), " got back ", amt(e.principal + e.interest), "."];
    case "rug_claimed":
      return [who(e.investor), " took rug ", rug(e.rugId), " and ", amt(e.interest), " interest after ", who(e.store), " missed the buy-out."];
    case "rug_redeemed":
      return [who(e.holder), " collected rug ", rug(e.rugId), " from ", who(e.store), "."];
    default:
      return [`Unrecognised event "${e.name}".`];
  }
}

/** Plain text of a sentence, for tests and titles. */
export function plain(parts: Part[], name: (a: string) => string, money: (u: bigint) => string): string {
  return parts
    .map((p) =>
      typeof p === "string"
        ? p
        : "amount" in p
          ? money(p.amount)
          : "party" in p
            ? name(p.party)
            : `No. ${p.rug.toString().padStart(4, "0")}`,
    )
    .join("");
}

export const rugIdOf = (e: AppEvent): bigint | null => ("rugId" in e ? e.rugId : null);

export type RedeemEvent = Extract<AppEvent, { kind: "rug_redeemed" }>;

/** The hand-over (redeem) event for a rug, if the RPC still keeps it. */
export function findRedeem(rugId: bigint, events: AppEvent[]): RedeemEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === "rug_redeemed" && e.rugId === rugId) return e;
  }
  return null;
}

/** All contract events still kept by the RPC, oldest first. */
export async function fetchEvents(): Promise<{ events: AppEvent[]; trimmed: boolean }> {
  const srv = server();
  const health = await srv.getHealth();
  const startLedger = Math.max(DEPLOY_LEDGER, health.oldestLedger);
  const trimmed = health.oldestLedger > DEPLOY_LEDGER;
  const filters = [{ type: "contract" as const, contractIds: [CONTRACT_ID] }];
  const limit = 200;
  const events: AppEvent[] = [];
  let page = await srv.getEvents({ startLedger, filters, limit });
  for (let guard = 0; guard < 50; guard++) {
    for (const ev of page.events) {
      events.push(
        decodeEvent(ev.topic, ev.value, { id: ev.id, ledger: ev.ledger, at: ev.ledgerClosedAt, txHash: ev.txHash }),
      );
    }
    if (page.events.length < limit || !page.cursor) break;
    page = await srv.getEvents({ cursor: page.cursor, filters, limit });
  }
  return { events, trimmed };
}
