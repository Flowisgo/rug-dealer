"use client";
import { useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { LookingAs, NoViewer, PageHead, useViewer } from "@/components/shell";
import { MoneyBlock } from "@/components/money";
import { ActionButton, Empty, ErrorBox, KV, Loading, Party, Section, Tag } from "@/components/ui";
import { addr, i128, type Store } from "@/lib/contract";
import { formatLocal, parseUsdc, usdcLabel } from "@/lib/money";
import { invoke } from "@/lib/tx";
import { useLedger, type Ledger } from "@/lib/use-ledger";

export default function PlatformPage() {
  const { viewer, lookingAs } = useViewer();
  const { data, error, refresh } = useLedger();
  return (
    <>
      <PageHead
        title="Platform desk"
        lede="Approve which stores can write rug certificates, set how much each may have lent out at once, and freeze a store that breaks the rules."
      />
      {lookingAs && <LookingAs address={lookingAs} />}
      {!viewer ? (
        <NoViewer role="platform" what="manage stores" />
      ) : error && !data ? (
        <ErrorBox message={error} retry={() => void refresh()} />
      ) : !data ? (
        <Loading />
      ) : (
        <PlatformDesk viewer={viewer} data={data} />
      )}
    </>
  );
}

function PlatformDesk({ viewer, data }: { viewer: string; data: Ledger }) {
  const admin = data.config.admin;
  const stores = [...data.stores].sort((a, b) => Number(a.frozen) - Number(b.frozen));
  return (
    <>
      {viewer !== admin && (
        <div className="notice" style={{ marginTop: 24 }}>
          Only <Party address={admin} /> can approve stores, change limits or freeze. You can look, but switch accounts in Freighter to act.
        </div>
      )}

      <Section label="Stores" count={stores.length}>
        {stores.length === 0 ? (
          <Empty title="No stores yet.">Approve the first store below.</Empty>
        ) : (
          <div className="tickets">
            {stores.map((s) => (
              <StoreCard key={s.address} store={s} admin={admin} reason={data.frozenReason[s.address]} />
            ))}
          </div>
        )}
      </Section>

      <Section label="Approve a store">
        <ApproveForm admin={admin} known={stores.map((s) => s.address)} />
      </Section>

      <p className="small muted" style={{ marginTop: 24 }}>
        The platform can't move rugs or money. Each new loan pays it a 1% fee, once.
      </p>
    </>
  );
}

function StoreCard({ store, admin, reason }: { store: Store; admin: string; reason?: "Platform" | "MissedBuyout" }) {
  const [limit, setLimit] = useState("");
  const units = parseUsdc(limit);
  const pct = store.limit > 0n ? Number((store.open_principal * 1000n) / store.limit) / 10 : 100;
  const state = store.frozen
    ? { text: reason === "MissedBuyout" ? "Frozen: missed buy-out" : "Frozen by the platform", tone: "late" as const }
    : { text: "Approved", tone: "plain" as const };

  return (
    <article className="panel" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <div>
          <p className="panel-title" style={{ marginBottom: 2 }}>
            <Party address={store.address} store />
          </p>
          <p className="addr-full muted">{store.address}</p>
        </div>
        <Tag tone={state.tone}>{state.text}</Tag>
      </div>
      <div className="ticket-meta">
        <KV k="Limit">
          <MoneyBlock units={store.limit} />
        </KV>
        <KV k="Lent out now">
          <MoneyBlock units={store.open_principal} />
        </KV>
      </div>
      <div className={pct > 100 ? "meter over" : "meter"} aria-label="Limit used" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="split">
        <div>
          <label className="field" style={{ marginBottom: 10 }}>
            <span>New limit (USDC)</span>
            <input className="input mono" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="5000" />
            {units !== null && limit !== "" && <span className="hint mono">≈ {formatLocal(units)} TRY</span>}
          </label>
          <ActionButton
            label="Change limit"
            signer={admin}
            disabled={units === null || limit === ""}
            done="Limit changed."
            run={(onStep) =>
              invoke({ source: admin, method: "set_store_limit", args: [addr(store.address), i128(units!)], label: "Change store limit" }, onStep)
            }
          />
          {units !== null && units < store.open_principal && (
            <p className="small muted" style={{ marginTop: 6 }}>
              That's below what's lent out now. Existing loans carry on; new requests wait until it's back under the limit.
            </p>
          )}
        </div>
        {!store.frozen && (
          <div>
            <p className="small muted" style={{ marginBottom: 10 }}>
              Freezing stops this store writing new rug certificates. It's permanent. Loans already running carry on.
            </p>
            <ActionButton
              label="Freeze this store"
              signer={admin}
              confirm={{
                title: "Freeze this store for good?",
                body: (
                  <p>
                    <Party address={store.address} store /> will no longer be able to write rug certificates, and investors will see the flag.
                    There is no unfreeze.
                  </p>
                ),
                yes: "Freeze it",
              }}
              done="Frozen."
              run={(onStep) => invoke({ source: admin, method: "freeze_store", args: [addr(store.address)], label: "Freeze store" }, onStep)}
            />
          </div>
        )}
      </div>
    </article>
  );
}

function ApproveForm({ admin, known }: { admin: string; known: string[] }) {
  const [address, setAddress] = useState("");
  const [limit, setLimit] = useState("5000");
  const a = address.trim();
  const okAddr = StrKey.isValidEd25519PublicKey(a);
  const already = known.includes(a);
  const units = parseUsdc(limit);
  return (
    <div className="panel">
      <label className="field">
        <span>Store's Stellar address</span>
        <input className="input mono" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="G…" spellCheck={false} aria-invalid={a !== "" && !okAddr} />
        {a !== "" && !okAddr && <span className="error-text">That isn't a Stellar account address.</span>}
        {already && <span className="error-text">This store is already approved. Change its limit above instead.</span>}
      </label>
      <label className="field">
        <span>Limit: most it may have lent out at once (USDC)</span>
        <input className="input mono" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
        {units !== null && <span className="hint mono">≈ {formatLocal(units)} TRY</span>}
      </label>
      <ActionButton
        primary
        label={units !== null ? `Approve with a ${usdcLabel(units)} limit` : "Approve store"}
        signer={admin}
        disabled={!okAddr || already || units === null}
        done="Approved. The store can now write rug certificates."
        run={(onStep) => invoke({ source: admin, method: "register_store", args: [addr(a), i128(units!)], label: "Approve store" }, onStep)}
      />
    </div>
  );
}
