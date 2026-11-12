import { formatLocal, formatUsdc, LOCAL_CURRENCY } from "@/lib/money";

/** USDC amount with the local-currency estimate underneath. */
export function MoneyBlock({ units, big = false }: { units: bigint; big?: boolean }) {
  return (
    <span className={big ? "money big" : "money"}>
      <span className="usdc">{formatUsdc(units)} USDC</span>
      <span className="local">
        ≈ {formatLocal(units)} {LOCAL_CURRENCY}
      </span>
    </span>
  );
}

/** Inline amount for sentences: "600.00 USDC (≈ 27,000 TRY)". */
export function MoneyInline({ units }: { units: bigint }) {
  return (
    <span className="money-inline">
      {formatUsdc(units)} USDC{" "}
      <span className="local">
        (≈ {formatLocal(units)} {LOCAL_CURRENCY})
      </span>
    </span>
  );
}
