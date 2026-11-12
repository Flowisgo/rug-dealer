import Link from "next/link";
import type { Part } from "@/lib/events";
import { rugNo } from "@/lib/money";
import { MoneyInline } from "./money";
import { Party } from "./ui";

/** Render an event sentence: names in bold, amounts in mono with TRY, rug
 * numbers linking to the rug's history. */
export function Sentence({ parts }: { parts: Part[] }) {
  return (
    <span>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : "amount" in p ? (
          <MoneyInline key={i} units={p.amount} />
        ) : "party" in p ? (
          <span key={i} className="party">
            <Party address={p.party} store={p.role === "store"} />
          </span>
        ) : (
          <Link key={i} className="rugref" href={`/rug/${p.rug}`}>
            {rugNo(p.rug)}
          </Link>
        ),
      )}
    </span>
  );
}

export function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function whenSec(sec: bigint) {
  return when(new Date(Number(sec) * 1000).toISOString());
}
