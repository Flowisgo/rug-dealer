"use client";
import Link from "next/link";
import { Kilim } from "@/components/kilim";
import { MoneyInline } from "@/components/money";
import { LedgerRows, Party, Section } from "@/components/ui";
import { useWallet } from "@/components/wallet";
import { ACCOUNTS, DEMO_NAMES } from "@/lib/deployment";
import { RUG_PATTERN_NOTE } from "@/lib/kilim";
import { formatUsdc, quoteLocally, UNIT } from "@/lib/money";

// The guide's worked example, computed with the same maths as the contract.
const EXAMPLE = quoteLocally(600n * UNIT, 6, { interest_bps_per_year: 1500, platform_fee_bps: 100, store_fee_bps_per_month: 25 });
const usd = (u: bigint) => `${formatUsdc(u)} USDC`;

/** The hero rug: always the same one, so the first thing people see doesn't change. */
const HERO_SEED = 2;

const DESKS = [
  {
    href: "/store",
    name: "Rug store",
    line: "Price rugs and write their certificates. Buy a rug when its loan isn't repaid. Hand rugs over.",
    who: ACCOUNTS.store,
  },
  {
    href: "/weaver",
    name: "Weaver",
    line: "Borrow against your rug, repay, and collect it when you're ready to sell.",
    who: ACCOUNTS.weaver,
  },
  {
    href: "/investor",
    name: "Investor",
    line: "Fund one loan, see what you'll earn, and take the rug if the store misses its buy-out.",
    who: ACCOUNTS.investor,
  },
  {
    href: "/platform",
    name: "Platform",
    line: "Approve stores, set how much each may have lent out, and freeze a store that breaks the rules.",
    who: ACCOUNTS.admin,
  },
];

const DESK_FOR_ROLE: Record<string, string> = { store: "/store", weaver: "/weaver", investor: "/investor", platform: "/platform" };

export default function Home() {
  const w = useWallet();
  const known = w.address ? DEMO_NAMES[w.address] : undefined;
  const desk = known ? DESK_FOR_ROLE[known.role] : undefined;
  const cost = EXAMPLE.principal - EXAMPLE.weaver_payout;

  return (
    <>
      <div className="hero">
        <div>
          <h1 className="hero-title">Leave the rug at the store. Borrow its price today.</h1>
          <p className="hero-lede">
            A weaver borrows what the store would pay for a finished rug. Repay, and the rug is theirs to sell to a real buyer for a better
            price. If they don't, the store buys the rug at that price. The investor is paid either way.
          </p>
          <div className="btn-row hero-actions">
            {w.address ? (
              <>
                {desk ? (
                  <Link className="btn btn-primary" href={desk}>
                    Open my desk
                  </Link>
                ) : null}
                <span className="small muted">
                  Connected as <Party address={w.address} />.
                </span>
              </>
            ) : (
              <button className="btn btn-primary" onClick={() => void w.connect()} disabled={w.connecting}>
                {w.connecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
            <Link className="btn" href="/activity">
              See every loan so far
            </Link>
          </div>
          {w.error && (
            <p className="error-text" style={{ marginTop: 12 }}>
              {w.error}
            </p>
          )}
        </div>

        <figure className="hero-rug" aria-label="Worked example: a 600 USDC loan over 6 months" style={{ margin: 0 }}>
          <div className="hero-loom">
            <Kilim seed={HERO_SEED} weave />
            <p className="rug-note">{RUG_PATTERN_NOTE}</p>
          </div>
          <figcaption className="hero-tag">
            <p className="hero-tag-title">A rug a buyer would pay about 1,500 USDC for</p>
            <p className="small muted">The store would buy it for 600 USDC. The weaver borrows that for 6 months.</p>
            <LedgerRows
              rows={[
                { label: "Investor lends", units: EXAMPLE.principal },
                { label: "Interest held for the investor", units: EXAMPLE.interest },
                { label: "Platform fee, once", units: EXAMPLE.platform_fee },
                { label: "Store fee for holding the rug", units: EXAMPLE.store_fee },
                { label: "Weaver receives today", units: EXAMPLE.weaver_payout, total: true },
              ]}
            />
          </figcaption>
        </figure>
      </div>

      <Section label="How a loan ends">
        <div className="outcomes">
          <article className="outcome">
            <h3>The weaver repays</h3>
            <p>Any time before the store buys the rug, the weaver pays back {usd(EXAMPLE.principal)}.</p>
            <dl>
              <div>
                <dt>Weaver</dt>
                <dd>Gets the rug back and sells it when a buyer comes. The loan cost {usd(cost)}.</dd>
              </div>
              <div>
                <dt>Store</dt>
                <dd>Earned {usd(EXAMPLE.store_fee)} for holding the rug.</dd>
              </div>
              <div>
                <dt>Investor</dt>
                <dd>
                  Gets back <MoneyInline units={EXAMPLE.investor_payout} />.
                </dd>
              </div>
            </dl>
          </article>
          <article className="outcome">
            <h3>The weaver doesn't repay</h3>
            <p>After the end date, the store has 7 days to buy the rug at the price it set.</p>
            <dl>
              <div>
                <dt>Weaver</dt>
                <dd>Keeps the {usd(EXAMPLE.weaver_payout)} and owes nothing more.</dd>
              </div>
              <div>
                <dt>Store</dt>
                <dd>Pays {usd(EXAMPLE.principal)} and owns the rug.</dd>
              </div>
              <div>
                <dt>Investor</dt>
                <dd>
                  Gets back <MoneyInline units={EXAMPLE.investor_payout} />.
                </dd>
              </div>
            </dl>
          </article>
        </div>
      </Section>

      <Section label="Pick your desk">
        <ul className="desks">
          {DESKS.map((d) => (
            <li key={d.href}>
              <Link href={d.href}>
                <span className="desk-name">{d.name}</span>
                <span className="desk-line">{d.line}</span>
                <span className="desk-who">
                  Demo: <Party address={d.who} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
