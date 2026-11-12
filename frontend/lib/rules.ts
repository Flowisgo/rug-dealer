// What a rug or loan means right now, in shopkeeper words. Pure functions so
// they can be tested and shared by every screen.
import type { Loan, Rug, Store } from "./contract";

export type Phase =
  | "requested" // waiting for an investor
  | "running" // funded, before end_at
  | "buyout" // end_at <= now < end_at + window: store may buy, weaver may still repay
  | "claimable" // now >= end_at + window: investor may take the rug, weaver may still repay
  | "closed";

export function loanPhase(loan: Loan, nowSec: bigint, windowSec: bigint): Phase {
  if (loan.status === "Requested") return "requested";
  if (loan.status !== "Funded" || loan.end_at === null) return "closed";
  if (nowSec < loan.end_at) return "running";
  if (nowSec < loan.end_at + windowSec) return "buyout";
  return "claimable";
}

export type Tone = "plain" | "waiting" | "secured" | "late" | "done";

export const LOAN_STATUS_TEXT: Record<Loan["status"], string> = {
  Requested: "Waiting for an investor",
  Funded: "Running",
  Cancelled: "Cancelled",
  Repaid: "Repaid",
  BoughtOut: "Bought by the store",
  Claimed: "Rug taken by investor",
};

/** Label for a rug as its weaver/holder sees it. */
export function rugLabel(rug: Rug, viewer?: string): { text: string; tone: Tone } {
  if (rug.status === "Redeemed") return { text: "Collected", tone: "done" };
  if (rug.status === "Requested") return { text: "Waiting for an investor", tone: "waiting" };
  if (rug.status === "Locked") return { text: "Held as security", tone: "secured" };
  // Only a buy-out leaves a store holding its own certificate.
  if (rug.owner === rug.store) return { text: "Bought by the store", tone: "plain" };
  if (viewer && rug.owner !== viewer) return { text: "Passed to a new holder", tone: "done" };
  return { text: "At the store, free to borrow", tone: "plain" };
}

// Who may take which part in a loan. The contract enforces the same rules
// (errors 22-24); checking first lets the desks explain instead of failing.

export const ROLE_TEXT = {
  weaverIsStore: "A store can't be the weaver on a rug certificate.",
  storeCannotBorrow: "Stores can't borrow against rugs.",
  investorIsParty: "You can't lend on a loan you're part of.",
} as const;

/** Any approved store, frozen or not, as the contract counts it. */
export const isStoreAddress = (address: string, stores: Store[]) => stores.some((s) => s.address === address);

/** Why a certificate can't be issued to this weaver, or null if it can. */
export const mintBlock = (weaver: string, stores: Store[]) => (isStoreAddress(weaver, stores) ? ROLE_TEXT.weaverIsStore : null);

/** Why this account can't ask for a loan, or null if it can. */
export const borrowBlock = (borrower: string, stores: Store[]) => (isStoreAddress(borrower, stores) ? ROLE_TEXT.storeCannotBorrow : null);

/** Why this account can't fund this loan, or null if it can. */
export const lendBlock = (investor: string, loan: Pick<Loan, "weaver" | "store">) =>
  investor === loan.weaver || investor === loan.store ? ROLE_TEXT.investorIsParty : null;

/** Latest loan on a rug (highest id). */
export function latestLoanFor(rugId: bigint, loans: Loan[]): Loan | null {
  let best: Loan | null = null;
  for (const l of loans) if (l.rug_id === rugId && (!best || l.id > best.id)) best = l;
  return best;
}

/** Open loan (requested or funded) on a rug, if any. */
export const openLoanFor = (rugId: bigint, loans: Loan[]) =>
  loans.find((l) => l.rug_id === rugId && (l.status === "Requested" || l.status === "Funded")) ?? null;

/** "4:05" / "1:02:03" style countdown from seconds. */
export function clock(seconds: bigint | number): string {
  let s = Math.max(0, Number(seconds));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export const monthsText = (m: number) => `${m} ${m === 1 ? "month" : "months"}`;

/** Totals for an investor's loans. Earned counts interest actually paid out. */
export function investorTotals(loans: Loan[], investor: string) {
  let lent = 0n;
  let earned = 0n;
  let expected = 0n;
  let open = 0;
  for (const l of loans) {
    if (l.investor !== investor) continue;
    lent += l.principal;
    if (l.status === "Repaid" || l.status === "BoughtOut" || l.status === "Claimed") earned += l.interest;
    if (l.status === "Funded") {
      expected += l.interest;
      open++;
    }
  }
  return { lent, earned, expected, open };
}
