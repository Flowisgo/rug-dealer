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

/** Amount inside a desk summary sentence: bold USDC, quiet lira after it. */
export function MoneySentence({ units }: { units: bigint }) {
  return (
    <>
      <strong>{formatUsdc(units)} USDC</strong>{" "}
      <span className="local">
        (≈ {formatLocal(units)} {LOCAL_CURRENCY})
      </span>
    </>
  );
}

/** Inline amount for sentences: "600.00 USDC (≈ 27,000 TRY)". */
export function MoneyInline({ units }: { units: bigint }) {
  return (
    <span className="money-inline">
      <span className="usdc">{formatUsdc(units)} USDC</span>{" "}
      <span className="local">
        (≈ {formatLocal(units)} {LOCAL_CURRENCY})
      </span>
    </span>
  );
}
