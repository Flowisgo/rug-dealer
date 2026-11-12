"use client";
import { HandoverPanel } from "@/components/rug-actions";
import { LookingAs, NoViewer, PageHead, useViewer } from "@/components/shell";
import { MoneyBlock, MoneyInline, MoneySentence } from "@/components/money";
import { whenSec } from "@/components/sentence";
import { ActionButton, Countdown, Empty, ErrorBox, KV, LedgerRows, Loading, Party, RugCard, Section, Tag } from "@/components/ui";
import { addr, u64, type Loan, type Rug } from "@/lib/contract";
import { rugNo, usdcLabel } from "@/lib/money";
import { investorTotals, lendBlock, loanPhase, LOAN_STATUS_TEXT, monthsText, type Tone } from "@/lib/rules";
import { invoke } from "@/lib/tx";
import { useLedger, useNow, type Ledger } from "@/lib/use-ledger";

export default function InvestorPage() {
  const { viewer, lookingAs } = useViewer();
  const { data, error, refresh } = useLedger();
  return (
    <>
      <PageHead
        title="Investor desk"
        lede="Lend the store's price on one rug. You get it back with interest, from the weaver if they repay or from the store if it buys the rug."
      />
      {lookingAs && <LookingAs address={lookingAs} />}
      {!viewer ? (
        <NoViewer role="investor" what="lend and see your loans" />
      ) : error && !data ? (
        <ErrorBox message={error} retry={() => void refresh()} />
      ) : !data ? (
        <Loading />
      ) : (
        <InvestorDesk investor={viewer} data={data} />
      )}
    </>
  );
}

function InvestorDesk({ investor, data }: { investor: string; data: Ledger }) {
  const now = useNow();
  const win = data.config.buyout_window_seconds;
  const rugById = new Map(data.rugs.map((r) => [r.id, r]));
  const requests = data.loans.filter((l) => l.status === "Requested").sort((a, b) => Number(b.id - a.id));
  const mine = data.loans.filter((l) => l.investor === investor).sort((a, b) => Number(b.id - a.id));
  const holding = data.rugs.filter((r) => r.owner === investor && r.status === "Free");
  const collected = data.rugs.filter((r) => r.owner === investor && r.status === "Redeemed");
  const t = investorTotals(data.loans, investor);

  return (
    <>
      <p className="summary">
        {t.lent === 0n ? (
          <>You haven't lent yet. Open requests are below.</>
        ) : (
          <>
            You've lent <MoneySentence units={t.lent} /> and earned <MoneySentence units={t.earned} /> in interest.{" "}
            {t.open === 0 ? (
              "No loans of yours are running."
            ) : (
              <>
                <MoneySentence units={t.expected} /> more is due from {t.open === 1 ? "one running loan" : `${t.open} running loans`}.
              </>
            )}
          </>
        )}
      </p>

      <Section label="Open requests" count={requests.length}>
        {requests.length === 0 ? (
          <Empty title="No one is waiting for a loan right now.">New requests appear here as soon as a weaver asks to borrow.</Empty>
        ) : (
          <div className="card-list">
            {requests.map((l) => (
              <RequestTicket key={l.id.toString()} loan={l} rug={rugById.get(l.rug_id)} investor={investor} data={data} />
            ))}
          </div>
        )}
      </Section>

      <Section label="Your loans" count={mine.length}>
        {mine.length === 0 ? (
          <Empty title="You haven't lent yet.">Fund an open request above. Your loans and what they've paid show here.</Empty>
        ) : (
          <div className="card-list">
            {mine.map((l) => (
              <MyLoan key={l.id.toString()} loan={l} rug={rugById.get(l.rug_id)} now={now} win={win} />
            ))}
          </div>
        )}
      </Section>

      {holding.length > 0 && (
        <Section label="Rugs you hold" count={holding.length}>
          <div className="card-list">
            {holding.map((r) => (
              <RugCard key={r.id.toString()} id={r.id} name={r.description} tag={<Tag tone="plain">Yours to collect</Tag>}>
                <div className="card-meta">
                  <KV k="At">
                    <Party address={r.store} store />
                  </KV>
                  <KV k="Store's price">
                    <MoneyBlock units={r.price} />
                  </KV>
                </div>
                <p className="small muted">You took this rug when the store missed its buy-out. Collect it from the store.</p>
                <HandoverPanel rug={r} holder={investor} />
              </RugCard>
            ))}
          </div>
        </Section>
      )}

      {collected.length > 0 && (
        <Section label="Earlier rugs" count={collected.length}>
          <div className="card-list">
            {collected.map((r) => (
              <RugCard key={r.id.toString()} id={r.id} name={r.description} tag={<Tag tone="done">Collected</Tag>}>
                <div className="card-meta">
                  <KV k="From">
                    <Party address={r.store} store />
                  </KV>
                  <KV k="Store's price">
                    <MoneyBlock units={r.price} />
                  </KV>
                </div>
                <p className="small muted">You collected this rug from the store. Its certificate is closed.</p>
              </RugCard>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function RequestTicket({ loan, rug, investor, data }: { loan: Loan; rug?: Rug; investor: string; data: Ledger }) {
  const store = data.stores.find((s) => s.address === loan.store);
  const overLimit = !!store && store.open_principal > store.limit;
  const party = lendBlock(investor, loan);
  return (
    <RugCard id={loan.rug_id} name={rug?.description ?? rugNo(loan.rug_id)} tag={<Tag tone="waiting">Waiting for an investor</Tag>}>
      <div className="card-meta">
        <KV k="Store">
          <Party address={loan.store} store />
        </KV>
        <KV k="Weaver">
          <Party address={loan.weaver} />
        </KV>
        <KV k="Term">{monthsText(loan.months)}</KV>
      </div>
      {store?.frozen && (
        <p className="notice warn small">
          <strong>{data.frozenReason[loan.store] === "MissedBuyout" ? "Frozen: missed buy-out." : "This store is frozen."}</strong> It missed
          a buy-out before. If this loan isn't repaid, you may end up with the rug instead of your money.
        </p>
      )}
      <LedgerRows
        rows={[
          { label: "You lend", units: loan.principal },
          { label: "You earn", units: loan.interest },
          { label: "You get back", units: loan.principal + loan.interest, total: true },
        ]}
      />
      <p className="small muted">
        Paid back by the weaver, or by the store if it buys the rug. Due {monthsText(loan.months)} after you fund it.
      </p>
      {overLimit && <p className="error-text">The store is over its limit, so this request can't be funded until other loans close.</p>}
      {party && (
        <p className="small">
          <strong>{party}</strong> {investor === loan.weaver ? "This is your own request." : "This rug is from your store."} Another investor
          has to fund it.
        </p>
      )}
      <ActionButton
        primary
        label={`Lend ${usdcLabel(loan.principal)}`}
        signer={investor}
        disabled={overLimit || !!party}
        done="Funded. The weaver has been paid."
        run={(onStep) =>
          invoke({ source: investor, method: "fund_loan", args: [addr(investor), u64(loan.id)], label: `Fund ${rugNo(loan.rug_id)}` }, onStep)
        }
      />
    </RugCard>
  );
}

function MyLoan({ loan, rug, now, win }: { loan: Loan; rug?: Rug; now: bigint; win: bigint }) {
  const phase = loanPhase(loan, now, win);
  const tone: Tone = phase === "running" ? "secured" : phase === "buyout" || phase === "claimable" ? "late" : "done";
  const text = phase === "running" ? "Running" : phase === "buyout" ? "Overdue" : phase === "claimable" ? "Store missed buy-out" : LOAN_STATUS_TEXT[loan.status];
  return (
    <RugCard id={loan.rug_id} name={rug?.description ?? rugNo(loan.rug_id)} tag={<Tag tone={tone}>{text}</Tag>}>
      <div className="card-meta">
        <KV k="You lent">
          <MoneyBlock units={loan.principal} />
        </KV>
        <KV k="Interest">
          <MoneyBlock units={loan.interest} />
        </KV>
        <KV k="Store">
          <Party address={loan.store} store />
        </KV>
        {phase === "running" && (
          <KV k="Due in">
            <Countdown to={loan.end_at!} />
          </KV>
        )}
        {(phase === "buyout" || phase === "claimable") && (
          <KV k="Was due">
            <span className="mono">{whenSec(loan.end_at!)}</span>
          </KV>
        )}
      </div>
      {phase === "buyout" && (
        <p className="small">
          The weaver hasn't repaid. The store can buy the rug for <Countdown to={loan.end_at! + win} /> more, and you'd get back{" "}
          <MoneyInline units={loan.principal + loan.interest} />. The weaver can still repay too.
        </p>
      )}
      {phase === "claimable" && (
        <>
          <p className="notice warn">
            <strong>The store missed its buy-out.</strong> You can take the rug and the <MoneyInline units={loan.interest} /> interest held
            for you. Your <MoneyInline units={loan.principal} /> is not returned; the rug stands in for it. The store will be frozen.
          </p>
          <ActionButton
            primary
            label="Take the rug"
            signer={loan.investor}
            confirm={{
              title: `Take ${rugNo(loan.rug_id)}?`,
              body: (
                <p>
                  You receive the rug's certificate and <MoneyInline units={loan.interest} /> interest instead of your loan back. The store is
                  frozen for good. The weaver can't repay after this.
                </p>
              ),
              yes: "Take the rug",
            }}
            done="The rug is yours. Collect it from the store."
            run={(onStep) => invoke({ source: loan.investor!, method: "claim_rug", args: [u64(loan.id)], label: `Take ${rugNo(loan.rug_id)}` }, onStep)}
          />
        </>
      )}
      {loan.status === "Repaid" && (
        <p className="small">
          The weaver repaid. You got back <MoneyInline units={loan.principal + loan.interest} />.
        </p>
      )}
      {loan.status === "BoughtOut" && (
        <p className="small">
          The store bought the rug. You got back <MoneyInline units={loan.principal + loan.interest} />.
        </p>
      )}
      {loan.status === "Claimed" && (
        <p className="small">
          You took the rug and <MoneyInline units={loan.interest} /> interest after the store missed its buy-out.
        </p>
      )}
    </RugCard>
  );
}
