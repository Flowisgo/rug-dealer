"use client";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { BuyoutButton, CoSignPanel, HandedOver } from "@/components/rug-actions";
import { LookingAs, NoViewer, PageHead, useViewer } from "@/components/shell";
import { MoneyBlock, MoneyInline, MoneySentence } from "@/components/money";
import { whenSec } from "@/components/sentence";
import { ActionButton, Countdown, Empty, ErrorBox, KV, LedgerRows, Loading, Party, RugCard, Section, Tag } from "@/components/ui";
import { addr, i128, str, type Loan, type Rug, type Store } from "@/lib/contract";
import { ACCOUNTS, DEMO_NAMES } from "@/lib/deployment";
import { redeemOwnRug } from "@/lib/handover";
import { AMOUNT_GUIDANCE, formatLocal, parseUsdc, quoteLocally, rugNo, usdcLabel } from "@/lib/money";
import { latestLoanFor, loanPhase, LOAN_STATUS_TEXT, mintBlock, monthsText, openLoanFor, rugLabel, type Tone } from "@/lib/rules";
import { invoke } from "@/lib/tx";
import { useLedger, useNow, type Ledger } from "@/lib/use-ledger";
import { StrKey } from "@stellar/stellar-sdk";

export default function StorePage() {
  const { viewer, lookingAs } = useViewer();
  const { data, error, refresh } = useLedger(viewer);
  const params = useSearchParams();
  const handover = params.get("handover");

  return (
    <>
      <PageHead
        title="Store desk"
        lede="Write a certificate for each rug you take in, at your normal buying price. If a loan isn't repaid, you buy the rug at that same price."
      />
      {lookingAs && <LookingAs address={lookingAs} />}
      {handover && data && (
        <div style={{ marginTop: 24 }}>
          <CoSignPanel initial={handover} rugs={data.rugs} events={data.events} />
        </div>
      )}
      {!viewer ? (
        <NoViewer role="store" what="open your store desk" />
      ) : error && !data ? (
        <ErrorBox message={error} retry={() => void refresh()} />
      ) : !data ? (
        <Loading />
      ) : (
        <StoreDesk address={viewer} data={data} hasHandover={!!handover} />
      )}
    </>
  );
}

function StoreDesk({ address, data, hasHandover }: { address: string; data: Ledger; hasHandover: boolean }) {
  const now = useNow();
  const store = data.stores.find((s) => s.address === address);
  const win = data.config.buyout_window_seconds;

  if (!store)
    return (
      <div className="notice warn" style={{ marginTop: 24 }}>
        <strong>This account isn't an approved store.</strong> <Party address={address} /> can't write rug certificates. The demo stores
        are <Party address={ACCOUNTS.store} /> and <Party address={ACCOUNTS.store2} />; switch accounts in Varial, or ask the platform
        to approve this one.
      </div>
    );

  const myLoans = data.loans.filter((l) => l.store === address);
  const overdue = myLoans.filter((l) => {
    const p = loanPhase(l, now, win);
    return p === "buyout" || p === "claimable";
  });
  const running = myLoans.filter((l) => ["running", "checking"].includes(loanPhase(l, now, win)));
  const myRugs = data.rugs.filter((r) => r.store === address).sort((a, b) => Number(b.id - a.id));
  const rugById = new Map(data.rugs.map((r) => [r.id, r]));

  return (
    <>
      <StoreStatus store={store} reason={data.frozenReason[address]} />
      {now === null && <p className="notice warn">Ledger time unavailable. Timed buy-out actions are disabled while the network is checked.</p>}

      <Section label="Overdue loans" count={overdue.length}>
        {overdue.length === 0 ? (
          <Empty title={now === null ? "Checking overdue loans…" : "Nothing overdue."}>When a loan passes its end date without repayment, it shows here with your buy-out window.</Empty>
        ) : (
          <div className="card-list">
            {overdue.map((l) => (
              <OverdueTicket key={l.id.toString()} loan={l} rug={rugById.get(l.rug_id)} now={now} win={win} />
            ))}
          </div>
        )}
      </Section>

      <Section label="Issue a rug certificate">
        {store.frozen ? (
          <Empty title="This store can't issue new certificates.">A frozen store can still buy out loans and hand rugs over.</Empty>
        ) : (
          <IssueForm store={store} data={data} />
        )}
      </Section>

      {!hasHandover && (
        <Section label="Hand a rug over">
          <CoSignPanel initial={null} rugs={data.rugs} events={data.events} titled={false} />
        </Section>
      )}

      <Section label={now === null ? "Loans awaiting time check" : "Loans running"} count={running.length}>
        {running.length === 0 ? (
          <Empty title="No loans running.">Funded loans on your rugs show here until they're repaid or due.</Empty>
        ) : (
          <div className="card-list">
            {running.map((l) => {
              const rug = rugById.get(l.rug_id);
              return (
                <RugCard key={l.id.toString()} id={l.rug_id} name={rug?.description ?? rugNo(l.rug_id)} tag={<Tag tone="secured">Held as security</Tag>}>
                  <div className="card-meta">
                    <KV k="Weaver">
                      <Party address={l.weaver} />
                    </KV>
                    <KV k="Loan">
                      <MoneyBlock units={l.principal} />
                    </KV>
                    <KV k="Due in">
                      <Countdown to={l.end_at!} />
                    </KV>
                  </div>
                </RugCard>
              );
            })}
          </div>
        )}
      </Section>

      <Section label="This store's rugs" count={myRugs.length}>
        {myRugs.length === 0 ? (
          <Empty title="No rugs yet.">Issue a certificate above when a weaver leaves a rug with you.</Empty>
        ) : (
          <div className="card-list">
            {myRugs.map((r) => (
              <StoreRug key={r.id.toString()} rug={r} store={address} loans={data.loans} />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

function StoreStatus({ store, reason }: { store: Store; reason?: "Platform" | "MissedBuyout" }) {
  const available = store.limit - store.open_principal;
  const pct = store.limit > 0n ? Number((store.open_principal * 1000n) / store.limit) / 10 : 100;
  return (
    <div style={{ marginTop: 24, display: "grid", gap: 16 }}>
      {store.frozen && (
        <div className="frozen-banner" role="status">
          <strong>{reason === "MissedBuyout" ? "Frozen: missed buy-out" : "Frozen by the platform"}</strong>
          This store can't issue new rug certificates, and investors see the flag. You can still buy out loans and hand rugs over. Freezing
          is permanent.
        </div>
      )}
      <p className="summary" style={{ marginTop: 0 }}>
        The platform lets up to <MoneySentence units={store.limit} /> be lent out on your rugs.{" "}
        {store.open_principal === 0n ? (
          "Nothing is out right now."
        ) : (
          <>
            <MoneySentence units={store.open_principal} /> is out now
            {available > 0n ? (
              <>
                , so <MoneySentence units={available} /> is left.
              </>
            ) : (
              ", so the limit is used up."
            )}
          </>
        )}
      </p>
      <div className={pct > 100 ? "meter over" : "meter"} role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Limit used">
        <span style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function OverdueTicket({ loan, rug, now, win }: { loan: Loan; rug?: Rug; now: bigint | null; win: bigint }) {
  const closes = loan.end_at! + win;
  const open = now !== null && now < closes;
  return (
    <RugCard id={loan.rug_id} name={rug?.description ?? rugNo(loan.rug_id)} tag={<Tag tone="late">Overdue</Tag>}>
      <div className="card-meta">
        <KV k="Weaver">
          <Party address={loan.weaver} />
        </KV>
        <KV k="Investor">{loan.investor ? <Party address={loan.investor} /> : "â€”"}</KV>
        <KV k="Was due">
          <span className="mono">{whenSec(loan.end_at!)}</span>
        </KV>
        <KV k={open ? "Buy-out window closes in" : "Buy-out window"}>{open ? <Countdown to={closes} /> : "Closed"}</KV>
      </div>
      {open ? (
        <>
          <p className="small">
            The weaver hasn't repaid. Buy the rug for <MoneyInline units={loan.principal} />; the investor is paid from that. The weaver can
            still repay until you do.
          </p>
          <BuyoutButton loan={loan} />
        </>
      ) : (
        <p className="notice warn">
          <strong>The buy-out window has closed.</strong> The investor can now take the rug, and this store will be frozen.
        </p>
      )}
    </RugCard>
  );
}

function StoreRug({ rug, store, loans }: { rug: Rug; store: string; loans: Loan[] }) {
  // Kept across ledger refreshes (the card stays mounted), so the success
  // state survives the rug turning Redeemed.
  const [closedHash, setClosedHash] = useState<string | null>(null);
  const open = openLoanFor(rug.id, loans);
  const last = latestLoanFor(rug.id, loans);
  let tag: { text: string; tone: Tone } = rugLabel(rug);
  if (rug.status === "Free" && rug.owner === store) tag = { text: "Bought by this store", tone: "plain" };
  else if (rug.status === "Free" && last?.status === "Claimed") tag = { text: "Held by the investor", tone: "plain" };
  return (
    <RugCard id={rug.id} name={rug.description} tag={<Tag tone={tag.tone}>{tag.text}</Tag>}>
      <div className="card-meta">
        <KV k="Holder">
          <Party address={rug.owner} store={rug.owner === rug.store} />
        </KV>
        <KV k="Price">
          <MoneyBlock units={rug.price} />
        </KV>
        {open && <KV k="Loan">{LOAN_STATUS_TEXT[open.status]}{open.status === "Funded" ? `, ${monthsText(open.months)}` : ""}</KV>}
      </div>
      {closedHash && <HandedOver rugId={rug.id} holder={store} hash={closedHash} self />}
      {!closedHash && rug.status === "Free" && rug.owner === store && (
        <>
          <p className="small muted">This rug is yours after the buy-out. Close its certificate when the rug leaves the store.</p>
          <ActionButton
            label="Close the certificate"
            signer={store}
            confirm={{
              title: `Close the certificate for ${rugNo(rug.id)}?`,
              body: "The certificate is destroyed and can't be used to borrow again. Do this when the rug leaves the store.",
              yes: "Close it",
            }}
            run={async (onStep) => {
              const r = await redeemOwnRug(store, rug.id, onStep);
              setClosedHash(r.hash);
              return r;
            }}
          />
        </>
      )}
    </RugCard>
  );
}

function IssueForm({ store, data }: { store: Store; data: Ledger }) {
  const [who, setWho] = useState<"demo" | "paste">("demo");
  const [pasted, setPasted] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("600");

  const weaver = who === "demo" ? ACCOUNTS.weaver : pasted.trim();
  const weaverValid = StrKey.isValidEd25519PublicKey(weaver);
  const weaverBlocked = weaverValid ? mintBlock(weaver, data.stores) : null;
  const weaverOk = weaverValid && !weaverBlocked;
  const bytes = new TextEncoder().encode(description.trim()).length;
  const descOk = bytes >= 1 && bytes <= 280;
  const units = parseUsdc(price);
  const priceOk = units !== null && units > 0n;
  const previews = useMemo(
    () => (priceOk ? [1, 6, 12].filter((m) => m <= data.config.max_months).map((m) => quoteLocally(units!, m, data.config)) : []),
    [priceOk, units, data.config],
  );

  return (
    <div className="split">
      <div className="panel">
        <fieldset style={{ border: 0, padding: 0, margin: "0 0 16px" }}>
          <legend className="small" style={{ fontWeight: 500, marginBottom: 8 }}>
            Whose rug is it?
          </legend>
          <div className="choices">
            <label className="choice">
              <input type="radio" name="who" checked={who === "demo"} onChange={() => setWho("demo")} />
              <span>{DEMO_NAMES[ACCOUNTS.weaver].name}</span>
            </label>
            <label className="choice">
              <input type="radio" name="who" checked={who === "paste"} onChange={() => setWho("paste")} />
              <span>Paste an address</span>
            </label>
          </div>
        </fieldset>
        {who === "paste" && (
          <label className="field">
            <span>Weaver's Stellar address</span>
            <input
              className="input mono"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="G…"
              aria-invalid={pasted !== "" && !weaverOk}
              spellCheck={false}
            />
            {pasted !== "" && !weaverValid && <span className="error-text">That isn't a Stellar account address (starts with G, 56 characters).</span>}
            {weaverBlocked && (
              <span className="error-text">
                {weaverBlocked} <Party address={weaver} store /> is an approved store. Issue it to the weaver's own account.
              </span>
            )}
            <span className="hint">They'll need a USDC trustline to receive the loan.</span>
          </label>
        )}
        <label className="field">
          <span>What is the rug?</span>
          <textarea
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Hand-knotted wool, madder red field, 160 × 230 cm"
            aria-invalid={description !== "" && !descOk}
          />
          <span className="hint">
            <span className="mono">{bytes}</span>/280. This becomes the rug's name everywhere.
          </span>
        </label>
        <label className="field">
          <span>Your buying price</span>
          <input
            className="input mono"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            aria-invalid={price !== "" && !priceOk}
          />
          <span className="hint">
            {priceOk ? (
              <span className="mono">{usdcLabel(units!)} · ≈ {formatLocal(units!)} TRY</span>
            ) : (
              <span className="error-text">Enter a valid USDC amount above zero.</span>
            )}{" "}
            {AMOUNT_GUIDANCE} What you'd normally pay for this rug. You must buy it at this price if the loan isn't repaid.
          </span>
        </label>
        <ActionButton
          primary
          label="Issue rug certificate"
          signer={store.address}
          disabled={!weaverOk || !descOk || !priceOk}
          done="Certificate issued. The weaver can now borrow against it."
          run={async (onStep) => {
            const r = await invoke(
              {
                source: store.address,
                method: "mint_rug",
                args: [addr(store.address), addr(weaver), str(description.trim()), i128(units!)],
                label: "Issue rug certificate",
              },
              onStep,
            );
            setDescription("");
            return r;
          }}
        />
      </div>
      <div className="panel" style={{ background: "transparent" }}>
        <p className="panel-title">What the weaver receives</p>
        {previews.length === 0 ? (
          <p className="muted small">Enter a price to see the weaver's payout.</p>
        ) : (
          <>
            <LedgerRows rows={previews.map((q) => ({ label: `If they borrow for ${monthsText(q.months)}`, units: q.weaver_payout }))} />
            <p className="small muted" style={{ marginTop: 10 }}>
              They repay the full price. Your fee for holding the rug is{" "}
              <MoneyInline units={previews.find((q) => q.months === 6)?.store_fee ?? previews[0].store_fee} /> on a 6-month loan, paid when
              it's funded.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
