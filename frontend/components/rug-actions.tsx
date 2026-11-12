"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { quote as quoteOnChain, u32, u64, addr, type Config, type Loan, type Rug, type Store } from "@/lib/contract";
import { messageOf } from "@/lib/errors";
import { txUrl } from "@/lib/deployment";
import { findRedeem, type AppEvent } from "@/lib/events";
import {
  checkHandover,
  decodeHandover,
  encodeHandover,
  handoverKey,
  signHandover,
  submitHandover,
  type Handover,
} from "@/lib/handover";
import { quoteLocally, rugNo, usdcLabel, type Quote } from "@/lib/money";
import { monthsText } from "@/lib/rules";
import { invoke } from "@/lib/tx";
import { MoneyInline } from "./money";
import { when } from "./sentence";
import { ActionButton, LedgerRows, Party, useSignerCheck } from "./ui";
import { useWallet } from "./wallet";

/** Weaver: pick 1–12 months, see the contract's quote, borrow. */
export function BorrowForm({ rug, config, store, weaver }: { rug: Rug; config: Config; store: Store | undefined; weaver: string }) {
  const [months, setMonths] = useState(6);
  const local = useMemo(() => quoteLocally(rug.price, months, config), [rug.price, months, config]);
  const [q, setQ] = useState<Quote | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setQ(null);
    setQErr(null);
    const t = setTimeout(() => {
      quoteOnChain(rug.price, months).then(
        (r) => alive && setQ(r),
        (e) => alive && setQErr(messageOf(e)),
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [rug.price, months]);

  const shown = q ?? local;
  const available = store ? store.limit - store.open_principal : 0n;
  const overLimit = !!store && rug.price > available;

  return (
    <div className="panel" style={{ background: "transparent" }}>
      <fieldset style={{ border: 0, padding: 0, margin: "0 0 14px" }}>
        <legend className="small" style={{ fontWeight: 500, marginBottom: 8 }}>
          How many months? <span className="muted">(1 month = 1 minute in this demo)</span>
        </legend>
        <div className="months" role="radiogroup">
          {Array.from({ length: config.max_months }, (_, k) => k + 1).map((m) => (
            <label key={m} className="choice">
              <input type="radio" name={`months-${rug.id}`} checked={months === m} onChange={() => setMonths(m)} aria-label={monthsText(m)} />
              <span>{m}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <LedgerRows
        rows={[
          { label: `Loan for ${monthsText(months)}`, units: shown.principal },
          { label: "Interest held for the investor", units: shown.interest },
          { label: "Platform fee, once", units: shown.platform_fee },
          { label: "Store fee for holding the rug", units: shown.store_fee },
          { label: "You receive now", units: shown.weaver_payout, total: true },
        ]}
      />
      <p className="small" style={{ margin: "10px 0 14px" }}>
        You repay <MoneyInline units={rug.price} /> within {monthsText(months)} of the loan being funded. Interest is for the whole term,
        even if you repay early. {q ? <span className="muted">Figures checked with the contract.</span> : qErr ? <span className="error-text">{qErr}</span> : <span className="muted">Checking with the contract…</span>}
      </p>
      {overLimit && (
        <p className="notice warn small" style={{ marginBottom: 12 }}>
          <strong>The store can't take this loan right now.</strong> It has <MoneyInline units={available > 0n ? available : 0n} /> of its
          limit left. Try again when other loans close.
        </p>
      )}
      <ActionButton
        primary
        label={`Ask for ${usdcLabel(rug.price)}`}
        signer={weaver}
        disabled={overLimit}
        done="Request sent. It now waits for an investor."
        run={(onStep) =>
          invoke({ source: weaver, method: "request_loan", args: [addr(weaver), u64(rug.id), u32(months)], label: `Borrow on ${rugNo(rug.id)}` }, onStep)
        }
      />
    </div>
  );
}

/** Holder signs their half of a rug hand-over and gets a link for the store. */
export function HandoverPanel({ rug, holder }: { rug: Rug; holder: string }) {
  const check = useSignerCheck(holder);
  const [h, setH] = useState<Handover | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(handoverKey(rug.id));
      if (saved) {
        const d = decodeHandover(saved);
        if (d.holder === holder) setH(d);
      }
    } catch {}
  }, [rug.id, holder]);

  const sign = async () => {
    setBusy(true);
    setErr(null);
    try {
      const d = await signHandover(holder, rug.id, rug.store);
      setH(d);
      try {
        localStorage.setItem(handoverKey(rug.id), encodeHandover(d));
      } catch {}
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const code = h ? encodeHandover(h) : "";
  const link = h && typeof window !== "undefined" ? `${window.location.origin}/store?handover=${code}` : "";
  const copy = (what: string, text: string) => void navigator.clipboard?.writeText(text).then(() => setCopied(what));

  if (!h)
    return (
      <div>
        <p className="small muted" style={{ marginBottom: 10 }}>
          Collecting needs two signatures: yours, then the store's when it hands you the rug. The certificate is then closed for good.
        </p>
        <div className="btn-row">
          <button className="btn" onClick={() => void sign()} disabled={busy || !check.ok}>
            {busy ? "Waiting for Varial…" : "Collect the rug"}
          </button>
        </div>
        {!check.ok && check.hint && <p className="small muted" style={{ marginTop: 6 }}>{check.hint}</p>}
        {err && <p className="error-text" style={{ marginTop: 6 }}>{err}</p>}
      </div>
    );

  return (
    <div className="notice">
      <p style={{ marginBottom: 8 }}>
        <strong>Your part is signed.</strong> Give this link to <Party address={rug.store} store />. They open it on their store desk, hand you
        the rug and sign. It works for about a day.
      </p>
      <div className="btn-row" style={{ marginBottom: 8 }}>
        <button className="btn" onClick={() => copy("link", link)}>
          {copied === "link" ? "Link copied" : "Copy link for the store"}
        </button>
        <button className="btn btn-quiet" onClick={() => copy("code", code)}>
          {copied === "code" ? "Code copied" : "Copy code only"}
        </button>
      </div>
      <details>
        <summary className="small">Show the code</summary>
        <textarea className="input code-box" readOnly value={code} aria-label="Hand-over code" />
      </details>
    </div>
  );
}

/** Success state after a hand-over is signed and confirmed. Indigo, not green. */
export function HandedOver({ rugId, holder, hash, self = false }: { rugId: bigint; holder: string; hash: string; self?: boolean }) {
  return (
    <div className="handed-over" role="status">
      <p className="handed-over-title">
        Rug handed over. Certificate <span className="mono">{rugNo(rugId)}</span> is closed.
      </p>
      <p>
        {self ? (
          <>
            <Party address={holder} store /> held it after the buy-out; it's off the books now.
          </>
        ) : (
          <>
            Collected by <Party address={holder} />.
          </>
        )}
      </p>
      <p className="btn-row small">
        <a href={txUrl(hash)} target="_blank" rel="noreferrer">
          See the transaction
        </a>
        <Link href={`/rug/${rugId}`}>Open the rug's history</Link>
      </p>
    </div>
  );
}

/** Neutral note when a code is opened after the rug was already handed over. */
function AlreadyHandedOver({ rug, events }: { rug: Rug; events: AppEvent[] }) {
  const ev = findRedeem(rug.id, events);
  return (
    <div className="notice quiet" role="status">
      <p>
        Rug <span className="mono">{rugNo(rug.id)}</span> was already handed over to <Party address={ev?.holder ?? rug.owner} store={(ev?.holder ?? rug.owner) === rug.store} />
        {ev ? (
          <>
            {" "}
            on <time className="mono" dateTime={ev.at}>{when(ev.at)}</time>
          </>
        ) : null}
        . Nothing more to do.
      </p>
      <p className="small" style={{ marginTop: 6 }}>
        <Link href={`/rug/${rug.id}`}>Open the rug's history</Link>
      </p>
    </div>
  );
}

/** Store: open a holder's hand-over code, check it, co-sign and submit. */
export function CoSignPanel({
  initial,
  rugs,
  events,
  titled = true,
}: {
  initial: string | null;
  rugs: Rug[];
  events: AppEvent[];
  titled?: boolean;
}) {
  const w = useWallet();
  const [text, setText] = useState(initial ?? "");
  // Set once this session's "Sign and hand over" is confirmed.
  const [doneHash, setDoneHash] = useState<string | null>(null);
  let parsed: Handover | null = null;
  let parseErr: string | null = null;
  if (text.trim()) {
    try {
      parsed = decodeHandover(text);
    } catch (e) {
      parseErr = messageOf(e);
    }
  }
  const rug = parsed ? rugs.find((r) => r.id === BigInt(parsed!.rug)) : undefined;
  const state = parsed ? checkHandover(parsed, rug) : null;

  return (
    <div className="panel">
      {titled && <p className="panel-title">Hand a rug over</p>}
      {!doneHash && (
        <label className="field">
          <span>Hand-over code from the rug's holder</span>
          <textarea
            className="input code-box"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the code, or open the link the holder sent you"
          />
        </label>
      )}
      {parseErr && <p className="error-text">{parseErr}</p>}
      {parsed && doneHash && (
        <>
          <HandedOver rugId={BigInt(parsed.rug)} holder={parsed.holder} hash={doneHash} />
          <p className="small" style={{ marginTop: 12 }}>
            <button
              className="btn btn-quiet"
              onClick={() => {
                setDoneHash(null);
                setText("");
              }}
            >
              Hand over another rug
            </button>
          </p>
        </>
      )}
      {parsed && !doneHash && (
        <div style={{ display: "grid", gap: 12 }}>
          {state === "old-contract" ? (
            <p className="error-text">
              This code is from an earlier version of the demo, before it was reset. Ask the holder to press Collect the rug again and send a
              new link.
            </p>
          ) : state === "handed-over" && rug ? (
            <AlreadyHandedOver rug={rug} events={events} />
          ) : (
            <p>
              <Party address={parsed.holder} /> wants to collect rug <strong className="mono">{rugNo(BigInt(parsed.rug))}</strong>
              {rug ? <> ({rug.description})</> : null}. Hand the rug over, then sign to close its certificate.
            </p>
          )}
          {state === "unknown-rug" && <p className="error-text">There's no rug with this number yet. Refresh, or check the code.</p>}
          {state === "wrong-store" && <p className="error-text">This code names a different store than the rug's store.</p>}
          {state === "not-holder" && (
            <p className="error-text">
              <Party address={parsed.holder} /> no longer holds this rug, so this code can't be used. Ask the current holder for a new one.
            </p>
          )}
          {state === "ready" && (
            <>
              {w.address && w.address !== parsed.store && (
                <p className="small muted">
                  This needs <Party address={parsed.store} store />. Switch accounts in Varial.
                </p>
              )}
              <ActionButton
                primary
                label="Sign and hand over"
                signer={parsed.store}
                run={async (onStep) => {
                  const r = await submitHandover(parsed!, onStep);
                  setDoneHash(r.hash);
                  return r;
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Store buys the rug in its buy-out window. */
export function BuyoutButton({ loan }: { loan: Loan }) {
  return (
    <ActionButton
      primary
      label={`Buy the rug for ${usdcLabel(loan.principal)}`}
      signer={loan.store}
      done="Bought. The rug is now the store's."
      run={(onStep) => invoke({ source: loan.store, method: "store_buyout", args: [u64(loan.id)], label: `Buy ${rugNo(loan.rug_id)}` }, onStep)}
    />
  );
}
