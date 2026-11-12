"use client";
import Link from "next/link";
import { isValidElement, useRef, useState, type ReactNode } from "react";
import { accountUrl, DEMO_NAMES, txUrl } from "@/lib/deployment";
import { messageOf } from "@/lib/errors";
import { rugNo } from "@/lib/money";
import { clock, type Tone } from "@/lib/rules";
import { STEP_TEXT, type TxResult, type TxStep } from "@/lib/tx";
import { refreshLedger, useNow } from "@/lib/use-ledger";
import { short } from "@/lib/wallet";
import { MoneyBlock } from "./money";
import { RugCloth } from "./rug";
import { useWallet } from "./wallet";

export function Section({ label, count, children, id }: { label: string; count?: number; children: ReactNode; id?: string }) {
  return (
    <section className="section" id={id} aria-label={label}>
      <h2 className="section-label">
        <span>{label}</span>
        {count !== undefined && <span className="count">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

export function Tag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Loading({ what = "Reading the ledger from testnet…" }: { what?: string }) {
  return (
    <p className="skeleton" role="status">
      {what}
    </p>
  );
}

export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="notice warn" role="alert">
      <strong>Couldn't load this.</strong> {message}{" "}
      {retry && (
        <button className="btn btn-quiet" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** A person or business, by friendly demo name when we know them. */
export function Party({ address, link = false, store = false }: { address: string; link?: boolean; store?: boolean }) {
  const known = DEMO_NAMES[address];
  const label = known ? (
    known.name
  ) : store ? (
    <>
      Store <span className="mono">{short(address)}</span>
    </>
  ) : (
    <span className="mono">{short(address)}</span>
  );
  return link ? (
    <a href={accountUrl(address)} target="_blank" rel="noreferrer" title={address}>
      {label}
    </a>
  ) : (
    <span title={address}>{label}</span>
  );
}

export function Countdown({ to, done }: { to: bigint; done?: ReactNode }) {
  const now = useNow();
  const left = to - now;
  if (left <= 0n) return <>{done ?? "now"}</>;
  return <span className="mono">{clock(left)}</span>;
}

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span>{children}</span>
    </div>
  );
}

export function LedgerRows({ rows }: { rows: { label: ReactNode; units: bigint; total?: boolean }[] }) {
  return (
    <dl className="ledger">
      {rows.map((r, i) => (
        <div key={i} className={r.total ? "ledger-row total" : "ledger-row"}>
          <dt>{r.label}</dt>
          <dd>
            <MoneyBlock units={r.units} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The dye of a rug card's border comes from its status tag, so the tag stays
 * the one source of truth for how a rug is doing. */
export function toneOf(tag: ReactNode): Tone {
  return isValidElement<{ tone: Tone }>(tag) && tag.type === Tag ? tag.props.tone : "plain";
}

/** A rug seen from above: a plain field with crisp long sides, woven end
 * bands dyed by status and seeded by the rug number, knotted fringe, and the
 * rug number on a cloth label sewn to the top band. */
export function RugCard({
  id,
  name,
  tag,
  children,
}: {
  id: bigint;
  name: string;
  tag?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className="rug" data-tone={toneOf(tag)}>
      <RugCloth
        seed={Number(id)}
        head={
          <div className="rug-head">
            <Link className="rug-label" href={`/rug/${id}`} title="Open this rug's history">
              {rugNo(id)}
            </Link>
            <h3 className="rug-name">{name}</h3>
            {tag && <div className="rug-status">{tag}</div>}
          </div>
        }
      >
        {children}
      </RugCloth>
    </article>
  );
}

/** Who must sign, and a hint when the connected wallet is someone else. */
export function useSignerCheck(signer: string | null) {
  const w = useWallet();
  if (!signer) return { ok: false, hint: null as ReactNode };
  if (!w.address) return { ok: false, hint: <>Connect Freighter as <Party address={signer} /> to do this.</> };
  if (w.address !== signer)
    return {
      ok: false,
      hint: (
        <>
          This needs <Party address={signer} />. Freighter has <Party address={w.address} /> selected; switch accounts in Freighter.
        </>
      ),
    };
  return { ok: true, hint: null as ReactNode };
}

/** A button that runs one signed action and reports each step in plain words. */
export function ActionButton({
  label,
  signer,
  run,
  primary = false,
  confirm,
  done,
  disabled,
}: {
  label: string;
  signer: string | null;
  run: (onStep: (s: TxStep) => void) => Promise<TxResult | unknown>;
  primary?: boolean;
  /** Ask before acting: the text of the confirmation question. */
  confirm?: { title: string; body: ReactNode; yes: string };
  done?: string;
  disabled?: boolean;
}) {
  const check = useSignerCheck(signer);
  const w = useWallet();
  const [step, setStep] = useState<TxStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const go = async () => {
    dialog.current?.close();
    setError(null);
    setHash(null);
    try {
      const r = await run((s) => setStep(s));
      if (r && typeof r === "object" && "hash" in r) setHash((r as TxResult).hash);
      void refreshLedger();
      w.refreshBalance();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setStep(null);
    }
  };

  return (
    <div className="action">
      <div className="btn-row">
        <button
          className={primary ? "btn btn-primary" : "btn"}
          disabled={disabled || !!step || !check.ok}
          onClick={() => (confirm ? dialog.current?.showModal() : void go())}
        >
          {step ? "Working…" : label}
        </button>
      </div>
      {!check.ok && check.hint && <p className="small muted" style={{ marginTop: 6 }}>{check.hint}</p>}
      {step && (
        <p className="step-text" role="status" style={{ marginTop: 6 }}>
          {STEP_TEXT[step]}
        </p>
      )}
      {error && (
        <p className="error-text" role="alert" style={{ marginTop: 6 }}>
          {error}
        </p>
      )}
      {hash && (
        <p className="small" style={{ marginTop: 6 }}>
          {done ?? "Done."}{" "}
          <a href={txUrl(hash)} target="_blank" rel="noreferrer">
            See it on the explorer
          </a>
        </p>
      )}
      {confirm && (
        <dialog ref={dialog} className="confirm">
          <h2 className="panel-title">{confirm.title}</h2>
          <div style={{ marginBottom: 18 }}>{confirm.body}</div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => void go()}>
              {confirm.yes}
            </button>
            <button className="btn" onClick={() => dialog.current?.close()}>
              Keep as is
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
