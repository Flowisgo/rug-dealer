import type { Loan } from "@/lib/contract";
import type { Ledger } from "@/lib/use-ledger";
import { loanPayout } from "@/lib/payouts";
import { MoneyInline } from "./money";

export function LoanPayout({
  loan,
  data,
}: {
  loan: Loan;
  data: Pick<Ledger, "events" | "eventsTrimmed" | "eventsError">;
}) {
  const payout = loanPayout(
    loan,
    data.events,
    !data.eventsTrimmed && !data.eventsError,
  );
  if (!payout) return null;
  return (
    <p className="small payout-status">
      Loan closed.{" "}
      {loan.status === "Claimed" &&
        "The investor owns the rug; principal is not refunded. "}
      {payout.status === "held"
        ? "Held as credit: "
        : payout.status === "received"
          ? "Received: "
          : "Settlement payout: "}
      <MoneyInline units={payout.amount} />.
      {payout.status === "held" &&
        " Not yet received. The investor must withdraw it after their wallet can accept USDC."}
      {payout.status === "unknown" &&
        " Delivery is unverified because event history is incomplete. Check held credit and the settlement transaction."}
    </p>
  );
}
