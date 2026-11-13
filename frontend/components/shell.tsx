"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ACCOUNTS, contractUrl, txUrl } from "@/lib/deployment";
import {
  loadPendings,
  hasUnreadablePending,
  resumePending,
  type Pending,
} from "@/lib/tx";
import { refreshLedger } from "@/lib/use-ledger";
import { StrKey } from "@stellar/stellar-sdk";
import { Kilim } from "./kilim";
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
        <strong>Stellar Testnet demo.</strong> A loan month and the buy-out
        window each last 60 seconds here. Lira amounts use an approximate rate.
      </p>
      <header className="site-header">
        <Link href="/" className="wordmark">
          <Kilim seed={0} fringe="none" />
          RugDealer
        </Link>
        <nav className="site-nav" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={path.startsWith(n.href) ? "page" : undefined}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <WalletChip />
      </header>
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
  const [records, setRecords] = useState<
    Record<string, { pending: Pending; status: string }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const observed = useRef<Record<string, { pending: Pending; status: string }>>(
    {},
  );
  useEffect(() => {
    let alive = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const saved = loadPendings();
        const unreadable = hasUnreadablePending();
        // A caller in this or another tab may remove its terminal record.
        // Keep checking hashes this banner has already shown until resolved.
        const waiting = Object.values(observed.current)
          .filter((r) => r.status === "NOT_FOUND")
          .map((r) => r.pending);
        const pending = new Map([...waiting, ...saved].map((p) => [p.hash, p]));
        const results = await Promise.all(
          [...pending.values()].map((p) => resumePending(p)),
        );
        if (!alive) return;
        setError(
          unreadable
            ? "A saved transaction record could not be read. Valid hashes are still being checked; check your wallet activity before retrying the unreadable action."
            : null,
        );
        const next = { ...observed.current };
        for (const r of results) if (r) next[r.pending.hash] = r;
        observed.current = next;
        setRecords(next);
        if (results.some((r) => r?.status === "SUCCESS")) void refreshLedger();
      } catch {
        if (alive)
          setError(
            "Couldn't check pending transactions. Their hashes are saved; retrying automatically.",
          );
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(check, 4000);
    window.addEventListener("storage", check);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("storage", check);
    };
  }, []);
  return (
    <div
      style={{
        maxWidth: "var(--max)",
        margin: "12px auto 0",
        padding: "0 var(--gutter)",
      }}
    >
      {error && <p className="notice warn">{error}</p>}
      {Object.values(records).map((p) => (
        <div key={p.pending.hash} className="notice" role="status">
          Your action ({p.pending.label}){" "}
          {p.status === "SUCCESS"
            ? "went through."
            : p.status === "FAILED"
              ? "failed. Nothing changed; you can try again."
              : p.status === "EXPIRED"
                ? "expired without confirmation. Check the transaction before retrying."
                : "is still waiting for the network. Checking automatically."}{" "}
          <a href={txUrl(p.pending.hash)} target="_blank" rel="noreferrer">
            Check it
          </a>
        </div>
      ))}
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
  const as = raw
    ? (ALIASES[raw] ?? (StrKey.isValidEd25519PublicKey(raw) ? raw : null))
    : null;
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
      <p className="panel-title">Connect Varial to {what}.</p>
      <p className="muted small" style={{ marginBottom: 14 }}>
        Use Varial on Testnet. The demo account for this desk is{" "}
        <Party address={DEMO_FOR[role]} />.
      </p>
      <div className="btn-row">
        <button
          className="btn btn-primary"
          onClick={() => void w.connect()}
          disabled={w.connecting}
        >
          {w.connecting ? "Connecting…" : "Connect wallet"}
        </button>
        <Link
          className="btn"
          href={`?as=${role === "platform" ? "platform" : role}`}
        >
          Look around as <Party address={DEMO_FOR[role]} />
        </Link>
      </div>
      {w.installed === false && (
        <p className="small muted" style={{ marginTop: 12 }}>
          Varial isn't installed in this browser, so you can look around but not
          sign.
        </p>
      )}
      {w.error && (
        <p className="error-text" style={{ marginTop: 12 }}>
          {w.error}
        </p>
      )}
    </div>
  );
}

/** Banner for the read-only ?as= view. */
export function LookingAs({ address }: { address: string }) {
  return (
    <div className="notice" style={{ marginTop: 20 }}>
      You're looking at this desk as <Party address={address} />. This preview
      is read-only, even with a matching wallet. Leave preview to sign.{" "}
      <Link href="?">Back to my own wallet</Link>
    </div>
  );
}
