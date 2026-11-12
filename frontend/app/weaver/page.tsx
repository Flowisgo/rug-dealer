"use client";
import Link from "next/link";
import { BorrowForm, HandoverPanel } from "@/components/rug-actions";
import { LookingAs, NoViewer, PageHead, useViewer } from "@/components/shell";
import { MoneyBlock, MoneyInline } from "@/components/money";
import { whenSec } from "@/components/sentence";
import { ActionButton, Countdown, Empty, ErrorBox, KV, Loading, Party, RugCard, Section, Tag } from "@/components/ui";
import { u64, type Loan, type Rug } from "@/lib/contract";
import { ACCOUNTS } from "@/lib/deployment";
import { rugNo, usdcLabel } from "@/lib/money";
import { borrowBlock, latestLoanFor, loanPhase, monthsText, openLoanFor, ROLE_TEXT, rugLabel, type Tone } from "@/lib/rules";
import { invoke } from "@/lib/tx";
import { useBalance, useLedger, useNow, type Ledger } from "@/lib/use-ledger";

export default function WeaverPage() {
  const { viewer, lookingAs } = useViewer();
  const { data, error, refresh } = useLedger();

  return (
    <>
      <PageHead
        title="Your rugs"
        lede="Borrow against a rug the store is holding for you. Repay the same amount to take it back and sell it when you find a buyer."
      />
      {lookingAs && <LookingAs address={lookingAs} />}
      {!viewer ? (
        <NoViewer role="weaver" what="see your rugs" />
      ) : error && !data ? (
        <ErrorBox message={error} retry={() => void refresh()} />
      ) : !data ? (
        <Loading />
      ) : (
        <WeaverDesk weaver={viewer} data={data} />
      )}
    </>
  );
}

function WeaverDesk({ weaver, data }: { weaver: string; data: Ledger }) {
  const now = useNow();
  const balance = useBalance(weaver);
  const win = data.config.buyout_window_seconds;

  // Rugs the weaver holds now, plus rugs they borrowed against before.
  const ids = new Set<bigint>();
  data.rugs.forEach((r) => r.owner === weaver && ids.add(r.id));
  data.loans.forEach((l) => l.weaver === weaver && ids.add(l.rug_id));
  data.events.forEach((e) => e.kind === "rug_minted" && e.weaver === weaver && ids.add(e.rugId));
  const mine = data.rugs.filter((r) => ids.has(r.id)).sort((a, b) => Number(b.id - a.id));
  const active = mine.filter((r) => r.status !== "Redeemed" && r.owner === weaver);
  const past = mine.filter((r) => !active.includes(r));

  const owed = data.loans.filter((l) => l.weaver === weaver && l.status === "Funded").reduce((s, l) => s + l.principal, 0n);

  return (
    <>
      <div className="stats three" style={{ marginTop: 24 }}>
        <div>
          <span className="k">Rugs at the store</span>
          <span className="mono" style={{ fontSize: "1.4rem" }}>
            {active.length}
          </span>
        </div>
        <div>
          <span className="k">You owe now</span>
          <MoneyBlock units={owed} />
        </div>
        <div>
          <span className="k">Wallet</span>
          {balance === undefined ? <span className="muted small">Reading…</span> : balance === null ? <span className="muted small">Can't hold USDC yet</span> : <MoneyBlock units={balance} />}
        </div>
      </div>

      <Section label="Your rugs" count={active.length}>
        {active.length === 0 ? (
          <Empty title="No rugs at a store yet.">
            Bring a finished rug to a store. When the store writes its certificate, it appears here and you can borrow against it.
            {weaver !== ACCOUNTS.weaver && (
              <>
                {" "}
                The demo weaver is <Party address={ACCOUNTS.weaver} />.
              </>
            )}
          </Empty>
        ) : (
          <div className="card-list">
            {active.map((rug) => (
              <WeaverRug key={rug.id.toString()} rug={rug} weaver={weaver} data={data} now={now} win={win} />
            ))}
          </div>
        )}
      </Section>

      {past.length > 0 && (
        <Section label="Earlier rugs" count={past.length}>
          <div className="card-list">
            {past.map((rug) => {
              const last = latestLoanFor(rug.id, data.loans);
              const label = pastLabel(rug, last, weaver);
              return (
                <RugCard key={rug.id.toString()} id={rug.id} name={rug.description} tag={<Tag tone={label.tone}>{label.text}</Tag>}>
                  <div className="card-meta">
                    <KV k="Store">
                      <Party address={rug.store} store />
                    </KV>
                    <KV k="Price">
                      <MoneyBlock units={rug.price} />
                    </KV>
                  </div>
                  <p className="small muted">{label.detail}</p>
                </RugCard>
              );
            })}
          </div>
        </Section>
      )}
    </>
  );
}

function pastLabel(rug: Rug, last: Loan | null, weaver: string): { text: string; tone: Tone; detail: string } {
  if (rug.status === "Redeemed" && rug.owner === weaver) return { text: "Collected", tone: "done", detail: "You collected this rug from the store." };
  if (last?.status === "BoughtOut") return { text: "Bought by the store", tone: "done", detail: "The loan wasn't repaid, so the store bought the rug. You owe nothing more." };
  if (last?.status === "Claimed") return { text: "Taken by the investor", tone: "done", detail: "The store missed its buy-out, so the investor took the rug. You owe nothing more." };
  return { text: "Passed to a new holder", tone: "done", detail: "This rug's certificate is with someone else now." };
}

function WeaverRug({ rug, weaver, data, now, win }: { rug: Rug; weaver: string; data: Ledger; now: bigint; win: bigint }) {
  const loan = openLoanFor(rug.id, data.loans);
  const store = data.stores.find((s) => s.address === rug.store);
  const phase = loan ? loanPhase(loan, now, win) : null;
  const late = phase === "buyout" || phase === "claimable";
  const label = late ? { text: "Late", tone: "late" as Tone } : rugLabel(rug, weaver);

  return (
    <RugCard id={rug.id} name={rug.description} tag={<Tag tone={label.tone}>{label.text}</Tag>}>
      <div className="card-meta">
        <KV k="Store">
          <Party address={rug.store} store />
        </KV>
        <KV k="Store's price">
          <MoneyBlock units={rug.price} />
        </KV>
        {loan?.status === "Funded" && loan.end_at !== null && (
          <KV k={late ? "Was due" : "Due in"}>{late ? <span className="mono">{whenSec(loan.end_at)}</span> : <Countdown to={loan.end_at} />}</KV>
        )}
      </div>

      {rug.status === "Free" && borrowBlock(weaver, data.stores) ? (
        <p className="notice small">
          <strong>{ROLE_TEXT.storeCannotBorrow}</strong>{" "}
          {rug.store === weaver ? (
            <>
              To close this rug's certificate, use <em>Close the certificate</em> on your <Link href="/store">store desk</Link>.
            </>
          ) : (
            <>This desk is for weavers.</>
          )}
        </p>
      ) : (
        rug.status === "Free" && (
          <>
            <BorrowForm rug={rug} config={data.config} store={store} weaver={weaver} />
            <HandoverPanel rug={rug} holder={weaver} />
          </>
        )
      )}

      {loan?.status === "Requested" && (
        <>
          <p>
            Waiting for an investor to lend <MoneyInline units={loan.principal} /> for {monthsText(loan.months)}. You'll receive{" "}
            <MoneyInline units={loan.weaver_payout} /> when it's funded.
          </p>
          <ActionButton
            label="Cancel the request"
            signer={weaver}
            done="Cancelled. The rug is free to borrow against again."
            run={(onStep) => invoke({ source: weaver, method: "cancel_request", args: [u64(loan.id)], label: `Cancel request on ${rugNo(rug.id)}` }, onStep)}
          />
        </>
      )}

      {loan?.status === "Funded" && (
        <>
          {late ? (
            <p className="notice warn">
              <strong>Late: you can still repay until the store buys the rug.</strong>{" "}
              {phase === "buyout" ? (
                <>
                  The store's buy-out window closes in <Countdown to={loan.end_at! + win} />.
                </>
              ) : (
                <>The store's window has closed; the investor can now take the rug. Repay first to keep it.</>
              )}
            </p>
          ) : (
            <p className="small muted">The store buys the rug if you don't repay. Repay any time before then to take it back.</p>
          )}
          <ActionButton
            primary
            label={`Repay ${usdcLabel(loan.principal)}`}
            signer={weaver}
            done="Repaid. The rug is yours again."
            run={(onStep) => invoke({ source: weaver, method: "repay", args: [u64(loan.id)], label: `Repay ${rugNo(rug.id)}` }, onStep)}
          />
        </>
      )}
    </RugCard>
  );
}
