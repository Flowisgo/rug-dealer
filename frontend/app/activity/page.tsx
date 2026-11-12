"use client";
import { useMemo, useState } from "react";
import { PageHead } from "@/components/shell";
import { Sentence, when } from "@/components/sentence";
import { Empty, ErrorBox, Loading, Section } from "@/components/ui";
import { txUrl } from "@/lib/deployment";
import { describe, heldPayoutTxs, type AppEvent } from "@/lib/events";
import { useLedger } from "@/lib/use-ledger";

const FILTERS: { key: string; label: string; kinds: AppEvent["kind"][] | null }[] = [
  { key: "all", label: "Everything", kinds: null },
  { key: "rugs", label: "Rugs", kinds: ["rug_minted", "rug_redeemed"] },
  { key: "loans", label: "Loans", kinds: ["loan_requested", "loan_cancelled", "loan_funded", "loan_repaid", "investor_credited", "credit_withdrawn"] },
  { key: "late", label: "Buy-outs and claims", kinds: ["store_bought_out", "rug_claimed", "store_frozen"] },
  { key: "stores", label: "Stores", kinds: ["store_registered", "store_limit_set", "store_frozen"] },
];

export default function ActivityPage() {
  const { data, error, refresh } = useLedger();
  const [filter, setFilter] = useState("all");

  const events = useMemo(() => {
    if (!data) return [];
    const kinds = FILTERS.find((f) => f.key === filter)?.kinds;
    return [...data.events].reverse().filter((e) => !kinds || kinds.includes(e.kind));
  }, [data, filter]);
  const held = useMemo(() => heldPayoutTxs(data?.events ?? []), [data]);

  return (
    <>
      <PageHead title="Activity" lede="Everything the contract has recorded, newest first. Each line links to its transaction on the testnet explorer." />

      <div className="choices" role="radiogroup" aria-label="Show" style={{ marginTop: 24 }}>
        {FILTERS.map((f) => (
          <label key={f.key} className="choice">
            <input type="radio" name="filter" checked={filter === f.key} onChange={() => setFilter(f.key)} />
            <span>{f.label}</span>
          </label>
        ))}
      </div>

      <Section label="Ledger" count={data ? events.length : undefined}>
        {error && !data && <ErrorBox message={error} retry={() => void refresh()} />}
        {!data && !error && <Loading />}
        {data?.eventsError && <ErrorBox message={data.eventsError} retry={() => void refresh()} />}
        {data && data.eventsTrimmed && (
          <p className="notice small" style={{ marginBottom: 12 }}>
            The testnet keeps about 7 days of history. Older lines are no longer available.
          </p>
        )}
        {data && !data.eventsError && events.length === 0 && (
          <Empty title="Nothing here yet.">Once a store writes a rug certificate, it shows up here.</Empty>
        )}
        {events.length > 0 && (
          <ul className="feed">
            {events.map((e) => (
              <li key={e.id}>
                <time dateTime={e.at}>{when(e.at)}</time>
                <Sentence parts={describe(e, held)} />
                <a className="tx" href={txUrl(e.txHash)} target="_blank" rel="noreferrer" title="Open the transaction on the explorer">
                  tx {e.txHash.slice(0, 8)}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
