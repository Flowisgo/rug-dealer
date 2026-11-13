"use client";
import { LoanPayout } from "@/components/payout";
import { eventsForRug } from "@/lib/payouts";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHead } from "@/components/shell";
import { Sentence, when, whenSec } from "@/components/sentence";
import { MoneyBlock } from "@/components/money";
import { Empty, ErrorBox, KV, Loading, Party, RugCard, Section, Tag } from "@/components/ui";
import { txUrl } from "@/lib/deployment";
import { describe, heldPayoutTxs, type AppEvent } from "@/lib/events";
import { RUG_PATTERN_NOTE } from "@/lib/kilim";
import { rugNo } from "@/lib/money";
import { latestLoanFor, loanPhase, LOAN_STATUS_TEXT, monthsText, openLoanFor, rugLabel, type Tone } from "@/lib/rules";
import { useLedger, useNow } from "@/lib/use-ledger";

export default function RugPage() {
  const params = useParams<{ id: string }>();
  const raw = params.id ?? "";
  const id = /^\d{1,19}$/.test(raw) ? BigInt(raw) : null;
  const { data, error, refresh } = useLedger();
  const now = useNow();
  const [copied, setCopied] = useState(false);

  if (id === null)
    return (
      <>
        <PageHead title="Rug not found" />
        <Empty title={`"${raw}" isn't a rug number.`}>
          Rug numbers are whole numbers, like <Link href="/rug/1">No. 0001</Link>.
        </Empty>
      </>
    );

  if (error && !data) return <ErrorBox message={error} retry={() => void refresh()} />;
  if (!data) return <Loading />;

  const rug = data.rugs.find((r) => r.id === id);
  if (!rug)
    return (
      <>
        <PageHead title={`${rugNo(id)} isn't issued yet`} />
        <div style={{ marginTop: 24 }}>
          <Empty title="No rug with this number.">
            Stores have issued {data.rugs.length} rug certificate{data.rugs.length === 1 ? "" : "s"} so far.{" "}
            <Link href="/activity">See all activity</Link>.
          </Empty>
        </div>
      </>
    );

  const win = data.config.buyout_window_seconds;
  const loans = data.loans.filter((l) => l.rug_id === id).sort((a, b) => Number(a.id - b.id));
  const open = openLoanFor(id, data.loans);
  const last = latestLoanFor(id, data.loans);
  const phase = open ? loanPhase(open, now, win) : null;

  const events = eventsForRug(id, data.loans, data.events);
  const held = heldPayoutTxs(data.events);

  let tag: { text: string; tone: Tone } = rugLabel(rug);
  if (phase === "buyout" || phase === "claimable") tag = { text: "Overdue", tone: "late" };
  else if (rug.status === "Free" && last?.status === "BoughtOut") tag = { text: "Bought by the store", tone: "plain" };
  else if (rug.status === "Free" && last?.status === "Claimed") tag = { text: "Held by the investor", tone: "plain" };

  const key = (e: AppEvent) => ["loan_funded", "loan_repaid", "store_bought_out", "rug_claimed", "rug_redeemed"].includes(e.kind);

  return (
    <>
      <PageHead title={`Rug ${rugNo(id)}`} lede="The full story of one rug certificate, straight from the contract. Share this page's link with anyone." />

      <div style={{ marginTop: 24 }}>
        <RugCard id={rug.id} name={rug.description} tag={<Tag tone={tag.tone}>{tag.text}</Tag>}>
          <div className="card-meta">
            <KV k="Store">
              <Party address={rug.store} link store />
            </KV>
            <KV k="Holder">
              <Party address={rug.owner} link store={rug.owner === rug.store} />
            </KV>
            <KV k="Store's price">
              <MoneyBlock units={rug.price} />
            </KV>
            {open && (
              <KV k="Loan">
                {LOAN_STATUS_TEXT[open.status]}, {monthsText(open.months)}
              </KV>
            )}
          </div>
          <p className="small muted">{RUG_PATTERN_NOTE}</p>
          <div className="btn-row">
            <button
              className="btn btn-quiet"
              onClick={() => void navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true))}
            >
              {copied ? "Link copied" : "Copy link to this rug"}
            </button>
          </div>
        </RugCard>
      </div>

      {loans.map((loan) => <LoanPayout key={loan.id.toString()} loan={loan} data={data} />)}
      <Section label="Timeline" count={events.length}>
        {data.eventsTrimmed && (
          <p className="notice small" style={{ marginBottom: 16 }}>
            The testnet keeps about 7 days of history, so early steps may be missing.
          </p>
        )}
        {events.length === 0 && loans.length === 0 ? (
          <Empty title="Nothing has happened to this rug yet." />
        ) : (
          <ol className="timeline">
            {events.map((e) => (
              <li key={e.id} className={key(e) ? "key" : undefined}>
                <time dateTime={e.at}>{when(e.at)}</time>
                <Sentence parts={describe(e, held)} />{" "}
                <a className="small" href={txUrl(e.txHash)} target="_blank" rel="noreferrer">
                  Transaction
                </a>
              </li>
            ))}
            {events.length === 0 &&
              loans.map((l) => (
                <li key={l.id.toString()}>
                  <time>{whenSec(l.requested_at)}</time>
                  Loan requested for {monthsText(l.months)}. Now: {LOAN_STATUS_TEXT[l.status].toLowerCase()}.
                </li>
              ))}
            {open?.status === "Funded" && open.end_at !== null && (
              <>
                <li>
                  <time>{whenSec(open.end_at)}</time>
                  {phase === "running" ? "Due. The weaver repays by then to take the rug back." : "Was due. The weaver can still repay until the store buys the rug or the investor claims it."}
                </li>
                <li>
                  <time>{whenSec(open.end_at + win)}</time>
                  {phase === "claimable"
                    ? "The store's buy-out window closed. The investor can take the rug."
                    : "The store's buy-out window closes. After that the investor can take the rug."}
                </li>
              </>
            )}
          </ol>
        )}
      </Section>
    </>
  );
}
