"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ACCOUNTS, contractUrl, txUrl } from "@/lib/deployment";
import { resumePending, type Pending } from "@/lib/tx";
import { refreshLedger } from "@/lib/use-ledger";
import { StrKey } from "@stellar/stellar-sdk";
import { Party } from "./ui";
import { useWallet, WalletChip } from "./wallet";

const NAV = [
  { href: "/store", label: "Store" },
  { href: "/weaver", label: "Weaver" },
  { href: "/investor", label: "Investor" },
  { href: "/platform", label: "Platform" },
  { href: "/activity", label: "Activity" },
];

export function Header() {
  const path = usePathname();
  return (
    <>
      <p className="testnet-strip">
        <strong>Stellar Testnet demo.</strong> 1 month = 1 minute in this demo; local currency is an approximate demo rate.
      </p>
      <header className="site-header">
        <Link href="/" className="wordmark">
          <span className="wordmark-knot" aria-hidden />
          RugDealer
        </Link>
        <nav className="site-nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path.startsWith(n.href) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <WalletChip />
      </header>
      <div className="band" aria-hidden />
      <PendingNotice />
    </>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <span>RugDealer prototype. No real money moves.</span>
      <a href={contractUrl} target="_blank" rel="noreferrer">
        Contract on the explorer
      </a>
      <Link href="/activity">Everything that happened</Link>
    </footer>
  );
}

/** If the page was reloaded mid-transaction, say what became of it. */
function PendingNotice() {
  const [p, setP] = useState<{ pending: Pending; status: string } | null>(null);
  useEffect(() => {
    resumePending()
      .then((r) => {
        setP(r);
        if (r?.status === "SUCCESS") void refreshLedger();
      })
      .catch(() => {});
  }, []);
  if (!p) return null;
  const text =
    p.status === "SUCCESS"
      ? "went through."
      : p.status === "FAILED"
        ? "failed. Nothing changed; you can try again."
        : "is still waiting for the network. Refresh in a minute.";
  return (
    <div style={{ maxWidth: "var(--max)", margin: "12px auto 0", padding: "0 var(--gutter)" }}>
      <div className={p.status === "FAILED" ? "notice warn" : "notice"} role="status">
        Your last action ({p.pending.label}) {text}{" "}
        <a href={txUrl(p.pending.hash)} target="_blank" rel="noreferrer">
          Check it
        </a>
      </div>
    </div>
  );
}

export type Role = "store" | "weaver" | "investor" | "platform";

const DEMO_FOR: Record<Role, string> = {
  store: ACCOUNTS.store,
  weaver: ACCOUNTS.weaver,
  investor: ACCOUNTS.investor,
  platform: ACCOUNTS.admin,
};
const ALIASES: Record<string, string> = {
  store: ACCOUNTS.store,
  store2: ACCOUNTS.store2,
  weaver: ACCOUNTS.weaver,
  investor: ACCOUNTS.investor,
  platform: ACCOUNTS.admin,
};

/** Whose screen this is: the connected wallet, or ?as=<address|alias> for a
 * read-only look at a demo account. */
export function useViewer() {
  const params = useSearchParams();
  const w = useWallet();
  const raw = params.get("as");
  const as = raw ? (ALIASES[raw] ?? (StrKey.isValidEd25519PublicKey(raw) ? raw : null)) : null;
  return { viewer: as ?? w.address, lookingAs: as, wallet: w.address };
}

export function PageHead({ title, lede }: { title: string; lede?: ReactNode }) {
  return (
    <div>
      <h1 className="page-title">{title}</h1>
      {lede && <p className="page-lede">{lede}</p>}
    </div>
  );
}

/** Shown when nobody is connected: connect, or look around as the demo account. */
export function NoViewer({ role, what }: { role: Role; what: string }) {
  const w = useWallet();
  return (
    <div className="panel" style={{ marginTop: 24 }}>
      <p className="panel-title">Connect Freighter to {what}.</p>
      <p className="muted small" style={{ marginBottom: 14 }}>
        Use Freighter on Testnet. The demo account for this desk is <Party address={DEMO_FOR[role]} />.
      </p>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => void w.connect()} disabled={w.connecting}>
          {w.connecting ? "Connecting…" : "Connect wallet"}
        </button>
        <Link className="btn" href={`?as=${role === "platform" ? "platform" : role}`}>
          Look around as <Party address={DEMO_FOR[role]} />
        </Link>
      </div>
      {w.installed === false && (
        <p className="small muted" style={{ marginTop: 12 }}>
          Freighter isn't installed in this browser, so you can look around but not sign.
        </p>
      )}
      {w.error && <p className="error-text" style={{ marginTop: 12 }}>{w.error}</p>}
    </div>
  );
}

/** Banner for the read-only ?as= view. */
export function LookingAs({ address }: { address: string }) {
  const w = useWallet();
  return (
    <div className="notice" style={{ marginTop: 20 }}>
      You're looking at <Party address={address} />
      's screen. {w.address === address ? "Freighter has this account, so you can act." : "To act, connect Freighter as this account."}{" "}
      <Link href="?">Back to my own wallet</Link>
    </div>
  );
}
