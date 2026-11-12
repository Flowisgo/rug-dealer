"use client";
import Link from "next/link";
import { LedgerRows, Party, Section, Tag } from "@/components/ui";
import { useWallet } from "@/components/wallet";
import { MoneyInline } from "@/components/money";
import { ACCOUNTS, DEMO_NAMES } from "@/lib/deployment";
import { quoteLocally, UNIT } from "@/lib/money";

// The guide's worked example, computed with the same maths as the contract.
const EXAMPLE = quoteLocally(600n * UNIT, 6, { interest_bps_per_year: 1500, platform_fee_bps: 100, store_fee_bps_per_month: 25 });

const ROLES = [
  {
    href: "/store",
    name: "Rug store",
    line: "Price rugs, write rug certificates, buy a rug when a loan isn't repaid, hand rugs over.",
    who: ACCOUNTS.store,
  },
  {
    href: "/weaver",
    name: "Weaver",
    line: "Borrow against your rug, repay, and collect the rug when you're ready to sell.",
    who: ACCOUNTS.weaver,
  },
  {
    href: "/investor",
    name: "Investor",
    line: "Fund a loan, see what you'll earn, and take the rug if the store misses its buy-out.",
    who: ACCOUNTS.investor,
  },
  {
    href: "/platform",
    name: "Platform",
    line: "Approve stores, set how much each may have lent out, and freeze a store that breaks the rules.",
    who: ACCOUNTS.admin,
  },
];

const DESK: Record<string, string> = { store: "/store", weaver: "/weaver", investor: "/investor", platform: "/platform" };

export default function Home() {
  const w = useWallet();
  const known = w.address ? DEMO_NAMES[w.address] : undefined;
  const desk = known ? DESK[known.role] : undefined;

  return (
    <>
      <div className="hero">
        <div>
          <h1 className="page-title">Leave the rug at the store. Borrow its price today.</h1>
          <p className="page-lede">
            A weaver borrows what the store would pay for a finished rug. Repay, and the rug is theirs to sell to a real buyer for a
            better price. If they don't, the store buys the rug at that price. The investor is paid either way.
          </p>
          <div className="btn-row" style={{ marginTop: 24 }}>
            {w.address ? (
              <>
                <span>
                  Connected as <Party address={w.address} />.
                </span>
                {desk && (
                  <Link className="btn btn-primary" href={desk}>
                    Open my desk
                  </Link>
                )}
              </>
            ) : (
              <button className="btn btn-primary" onClick={() => void w.connect()} disabled={w.connecting}>
                {w.connecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
            <Link className="btn" href="/activity">
              See what's happened so far
            </Link>
          </div>
          {w.error && (
            <p className="error-text" style={{ marginTop: 12 }}>
              {w.error}
            </p>
          )}
        </div>

        <article className="ticket" aria-label="Worked example">
          <div className="ticket-stub">
            <span className="ticket-no">No. 0000</span>
            <Tag tone="plain">Worked example</Tag>
          </div>
          <div className="ticket-body">
            <h2 className="rug-name">A rug a buyer would pay about 1,500 USDC for</h2>
            <p className="small muted">The store's buying price is 600 USDC. The weaver borrows it for 6 months.</p>
            <LedgerRows
              rows={[
                { label: "Investor lends", units: EXAMPLE.principal },
                { label: "Interest held for the investor", units: EXAMPLE.interest },
                { label: "Platform fee, once", units: EXAMPLE.platform_fee },
                { label: "Store fee for holding the rug", units: EXAMPLE.store_fee },
                { label: "Weaver receives today", units: EXAMPLE.weaver_payout, total: true },
              ]}
            />
            <p className="small">
              The investor gets back <MoneyInline units={EXAMPLE.investor_payout} />, whether the weaver repays or the store buys the
              rug.
            </p>
          </div>
        </article>
      </div>

      <Section label="How it works">
        <ol className="steps">
          <li>
            <strong>The store prices the rug</strong>
            <span className="muted">
              The weaver leaves a finished rug. The store writes a rug certificate at its normal buying price and keeps the rug safe.
            </span>
          </li>
          <li>
            <strong>An investor lends that price</strong>
            <span className="muted">
              The weaver picks 1 to 12 months. Interest and fees come off the top, once. The rest goes to the weaver straight away.
            </span>
          </li>
          <li>
            <strong>Repay, or the store buys the rug</strong>
            <span className="muted">
              Repay the price and collect the rug. If not, the store buys it at the same price, and the investor is paid from that.
            </span>
          </li>
        </ol>
      </Section>

      <Section label="Pick your desk">
        <div className="roles">
          {ROLES.map((r) => (
            <Link key={r.href} href={r.href} className="role">
              <span className="role-name">{r.name}</span>
              <span className="muted small">{r.line}</span>
              <span className="small">
                Demo account: <Party address={r.who} />
              </span>
              <span className="role-go">Open the {r.name.toLowerCase()} desk</span>
            </Link>
          ))}
        </div>
      </Section>
    </>
  );
}
