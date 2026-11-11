import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
const hex = (v: Uint8Array) =>
  Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("");
export type Terms = {
  advance: bigint;
  lender_due: bigint;
  custody_fee: bigint;
  fallback_price: bigint;
  duration_secs: bigint;
  lender: string;
  dealer: string;
};
export function units(n: bigint) {
  const sign = n < 0n ? "-" : "";
  const v = n < 0n ? -n : n;
  const fraction = (v % 10000000n)
    .toString()
    .padStart(7, "0")
    .replace(/0+$/, "");
  return `${sign}${(v / 10000000n).toLocaleString("en-US")}${fraction ? "." + fraction : ""}`;
}
export function parseAmount(v: string) {
  if (!/^\d+(\.\d{1,7})?$/.test(v))
    throw new Error(
      "Enter a nonnegative token amount with at most seven decimal places.",
    );
  const [a, b = ""] = v.split(".");
  return BigInt(a) * 10000000n + BigInt(b.padEnd(7, "0"));
}
export function receiptBytes(id: string) {
  if (!/^[a-f0-9]{64}$/i.test(id))
    throw new Error(
      "A receipt ID must contain exactly 64 hexadecimal characters.",
    );
  return nativeToScVal(
    Uint8Array.from(id.match(/../g)!.map((v) => parseInt(v, 16))),
    { type: "bytes" },
  );
}
export function newReceiptId() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}
export function termsValue(t: Terms) {
  const fields: Record<string, xdr.ScVal> = {
    advance: nativeToScVal(t.advance, { type: "i128" }),
    lender_due: nativeToScVal(t.lender_due, { type: "i128" }),
    custody_fee: nativeToScVal(t.custody_fee, { type: "i128" }),
    fallback_price: nativeToScVal(t.fallback_price, { type: "i128" }),
    duration_secs: nativeToScVal(t.duration_secs, { type: "u64" }),
    lender: new Address(t.lender).toScVal(),
    dealer: new Address(t.dealer).toScVal(),
  };
  return xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map(
        (k) =>
          new xdr.ScMapEntry({
            key: nativeToScVal(k, { type: "symbol" }),
            val: fields[k],
          }),
      ),
  );
}
