// USDC amounts are bigint base units with 7 decimals, exactly as the contract
// stores them. Never use floating point for money.

export const DECIMALS = 7;
export const UNIT = 10_000_000n;

/** Fixed demo rate. 1 USDC = 45 TRY. Change it here only. */
export const TRY_PER_USDC = 45n;
export const LOCAL_CURRENCY = "TRY";

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Whole part with optional thousands commas in groups of exactly three
 * ("1,250", "12,000,000"), then an optional dot and decimals. A comma used as a
 * decimal mark ("6,50") does not match. */
const AMOUNT = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d*))?$/;

/** Parse a typed USDC amount ("600", "600.5", "1,250.25") into base units.
 * Returns null for anything that is not a positive-or-zero number with at most
 * 7 decimals, including a comma written as a decimal mark ("6,50"): guessing
 * would be off by 100x. */
export function parseUsdc(input: string): bigint | null {
  const match = AMOUNT.exec(input.trim());
  if (!match) return null;
  const [, wholeText, frac = ""] = match;
  if (frac.length > DECIMALS) return null;
  return BigInt(wholeText.replace(/,/g, "")) * UNIT + BigInt(frac.padEnd(DECIMALS, "0") || "0");
}

/** Why a typed amount isn't accepted, in plain words; null when it is. */
export function amountProblem(input: string): string | null {
  const t = input.trim();
  if (t === "") return "Enter an amount.";
  if (parseUsdc(t) !== null) return null;
  if (/,\d{1,2}$/.test(t) || /^\d+,\d+$/.test(t)) return "Use a dot for decimals, like 6.50. Commas only separate thousands, like 1,250.";
  if (/\.(\d{8,})$/.test(t)) return "USDC has at most 7 decimals.";
  return "Enter a USDC amount above zero, like 600 or 1,250.50.";
}

/** "600.00", "7.50", "0.0000001", "-60.00". At least 2 decimals, at most 7,
 * trailing zeros past the second trimmed. */
export function formatUsdc(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / UNIT;
  let frac = (abs % UNIT).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${negative ? "-" : ""}${group(whole.toString())}.${frac}`;
}

/** Whole lira at the demo rate, half rounded up: 600 USDC -> "27,000". */
export function formatLocal(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const lira = (abs * TRY_PER_USDC + UNIT / 2n) / UNIT;
  return `${negative && lira > 0n ? "-" : ""}${group(lira.toString())}`;
}

export const usdcLabel = (units: bigint) => `${formatUsdc(units)} USDC`;
export const localLabel = (units: bigint) => `≈ ${formatLocal(units)} ${LOCAL_CURRENCY}`;

export type FeeParams = {
  interest_bps_per_year: number;
  platform_fee_bps: number;
  store_fee_bps_per_month: number;
};

export type Quote = {
  principal: bigint;
  months: number;
  interest: bigint;
  platform_fee: bigint;
  store_fee: bigint;
  weaver_payout: bigint;
  investor_payout: bigint;
};

/** Same maths as the contract's quote(): each fee rounds down on its own, and
 * the remainder goes to the weaver. Used for live previews; the borrow screen
 * also asks the contract's quote() before signing. */
export function quoteLocally(principal: bigint, months: number, p: FeeParams): Quote {
  const m = BigInt(months);
  const interest = (principal * BigInt(p.interest_bps_per_year) * m) / (10_000n * 12n);
  const platform_fee = (principal * BigInt(p.platform_fee_bps)) / 10_000n;
  const store_fee = (principal * BigInt(p.store_fee_bps_per_month) * m) / 10_000n;
  return {
    principal,
    months,
    interest,
    platform_fee,
    store_fee,
    weaver_payout: principal - interest - platform_fee - store_fee,
    investor_payout: principal + interest,
  };
}

/** Rug numbers print as "No. 0042". */
export const rugNo = (id: bigint | number) => `No. ${id.toString().padStart(4, "0")}`;
export const loanNo = (id: bigint | number) => `Loan ${id.toString().padStart(4, "0")}`;
