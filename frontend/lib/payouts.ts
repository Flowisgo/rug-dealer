import type { Loan } from "./contract";
import type { AppEvent } from "./events";

/** Loan closure and delivery are separate facts. A withdrawal empties all of
 * this investor's credit, so the first later withdrawal delivers this credit. */
export function loanPayout(
  loan: Loan,
  events: AppEvent[],
  historyComplete: boolean,
) {
  if (!["Repaid", "BoughtOut", "Claimed"].includes(loan.status)) return null;
  const amount =
    loan.status === "Claimed" ? loan.interest : loan.principal + loan.interest;
  const credited = events.findIndex(
    (e) => e.kind === "investor_credited" && e.loanId === loan.id,
  );
  if (credited >= 0) {
    const withdrawal = events
      .slice(credited + 1)
      .find(
        (e) => e.kind === "credit_withdrawn" && e.investor === loan.investor,
      );
    return {
      amount,
      status: withdrawal ? "received" : historyComplete ? "held" : "unknown",
    } as const;
  }
  const settled = events.some(
    (e) =>
      ["loan_repaid", "store_bought_out", "rug_claimed"].includes(e.kind) &&
      "loanId" in e &&
      e.loanId === loan.id,
  );
  return {
    amount,
    status: historyComplete && settled ? "received" : "unknown",
  } as const;
}

/** Include credit and its first subsequent aggregate withdrawal in each
 * affected rug's history, even though those events have no rugId. */
export function eventsForRug(
  id: bigint,
  loans: Loan[],
  events: AppEvent[],
): AppEvent[] {
  const ids = new Set(loans.filter((l) => l.rug_id === id).map((l) => l.id));
  const related = new Set<AppEvent>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind !== "investor_credited" || !ids.has(e.loanId)) continue;
    related.add(e);
    const withdrawal = events
      .slice(i + 1)
      .find((w) => w.kind === "credit_withdrawn" && w.investor === e.investor);
    if (withdrawal) related.add(withdrawal);
  }
  const claims = new Set(
    events
      .filter((e) => e.kind === "rug_claimed" && e.rugId === id)
      .map((e) => e.txHash),
  );
  return events.filter(
    (e) =>
      ("rugId" in e && e.rugId === id) ||
      related.has(e) ||
      (e.kind === "store_frozen" && claims.has(e.txHash)),
  );
}
