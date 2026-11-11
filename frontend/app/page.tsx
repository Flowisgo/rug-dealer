"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONTRACT,
  DEMO_RECEIPT,
  ROLES,
  Role,
  Receipt,
  Terms,
  ActionRecord,
  RugMeta,
  deployment,
  readReceipt,
  readDefaults,
  ledgerTime,
  walletInfo,
  restoreWallet,
  connectWallet,
  contractAction,
  addTrustline,
  awaitConfirmation,
  storedAction,
  storageKey,
  registryKey,
  newReceiptId,
  termsValue,
  amountValue,
  addressValue,
  units,
  parseAmount,
  txLink,
} from "../lib/stellar";
const message = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "Unable to complete this action. Refresh and try again.";
const short = (s: string) => `${s.slice(0, 7)}…${s.slice(-6)}`;
const titles: Record<Role, [string, string]> = {
  warehouse: ["A finished rug.", "A trusted receipt."],
  weaver: ["Your craft.", "Your terms."],
  dealer: ["A clear promise.", "A fair fallback."],
  lender: ["Finance the maker.", "Know the terms."],
  buyer: ["A rug worth", "waiting for."],
};
const finalStages = ["SaleSettled", "Repaid", "DealerPurchased"];
const initialDraft = {
  advance: "8",
  lender_due: "9",
  custody_fee: "1",
  fallback_price: "10",
  duration_secs: "300",
  lender: deployment.accounts.lender,
  dealer: deployment.accounts.dealer,
};
function readRegistry(): RugMeta[] {
  try {
    const value = JSON.parse(localStorage.getItem(registryKey) || "[]");
    return Array.isArray(value)
      ? value.filter(
          (v) =>
            typeof v.id === "string" &&
            /^[a-f0-9]{64}$/.test(v.id) &&
            typeof v.name === "string" &&
            typeof v.description === "string",
        )
      : [];
  } catch {
    return [];
  }
}
export default function FullDemo() {
  const [role, setRole] = useState<Role>("buyer");
  const [id, setId] = useState("");
  const [input, setInput] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [address, setAddress] = useState("");
  const [wallet, setWallet] = useState<Awaited<
    ReturnType<typeof walletInfo>
  > | null>(null);
  const [record, setRecord] = useState<ActionRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [clock, setClock] = useState(0);
  const [library, setLibrary] = useState<RugMeta[]>(
    deployment.receipts as RugMeta[],
  );
  const [draft, setDraft] = useState(initialDraft);
  const [salePrice, setSalePrice] = useState("15");
  const [weaver, setWeaver] = useState(deployment.accounts.weaver);
  const [name, setName] = useState("A finished warehouse rug");
  const [description, setDescription] = useState(
    "Illustrative demo rug held by the trusted warehouse.",
  );
  const lock = useRef(false);
  const load = useCallback(async (receiptId: string) => {
    const time = await ledgerTime();
    setClock(Number(time));
    if (!receiptId) {
      setReceipt(null);
      return null;
    }
    const r = await readReceipt(receiptId);
    setReceipt(r);
    return r;
  }, []);
  useEffect(() => {
    const init = async () => {
      const path = window.location.pathname.slice(1);
      if (ROLES.includes(path as Role)) setRole(path as Role);
      let publicRugs = deployment.receipts as RugMeta[];
      try {
        const response = await fetch("/demo-receipts.json", {
          cache: "no-store",
        });
        if (response.ok) {
          const values = await response.json();
          if (Array.isArray(values))
            publicRugs = values.filter(
              (v) =>
                typeof v.id === "string" &&
                /^[a-f0-9]{64}$/.test(v.id) &&
                typeof v.name === "string" &&
                typeof v.description === "string",
            );
        }
      } catch {
        /* Offline display metadata never replaces contract state. */
      }
      const selected =
        new URL(window.location.href).searchParams.get("receipt") ||
        publicRugs[0]?.id ||
        DEMO_RECEIPT;
      setId(selected);
      setInput(selected);
      const local = readRegistry();
      setLibrary([
        ...local,
        ...publicRugs.filter((d) => !local.some((l) => l.id === d.id)),
      ]);
      if (selected) setRecord(storedAction(selected));
      await Promise.all([
        load(selected),
        readDefaults().then((t) =>
          setDraft((d) => ({
            ...d,
            advance: units(t.advance).replaceAll(",", ""),
            lender_due: units(t.lender_due).replaceAll(",", ""),
            custody_fee: units(t.custody_fee).replaceAll(",", ""),
            fallback_price: units(t.fallback_price).replaceAll(",", ""),
            duration_secs: t.duration_secs.toString(),
          })),
        ),
        restoreWallet().then(async (a) => {
          if (a) {
            setAddress(a);
            setWallet(await walletInfo(a));
          }
        }),
      ]);
    };
    init()
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false));
  }, [load]);
  useEffect(() => {
    if (!id) return;
    const timer = setInterval(() => {
      if (!lock.current) load(id).catch((e) => setError(message(e)));
    }, 15000);
    return () => clearInterval(timer);
  }, [id, load]);
  const notify = (r: ActionRecord) => setRecord(r);
  const monitor = async (r: ActionRecord, target = id) => {
    setNotice("Submitted. Waiting for testnet confirmation…");
    const result = await awaitConfirmation(r);
    localStorage.setItem(storageKey(target), JSON.stringify(result));
    setRecord(result);
    if (result.status === "pending") {
      setNotice(
        "Still pending. Refresh status before another action; your transaction link is saved.",
      );
      return false;
    }
    if (result.status === "failed" || result.status === "expired") {
      if (/^[a-f0-9]{64}$/i.test(target)) await load(target);
      throw new Error(
        result.status === "failed"
          ? "The transaction failed on-chain. No successful settlement was recorded. Refresh and review before retrying."
          : "The transaction was not found before its time limit expired. Receipt state has been refreshed; review it before retrying.",
      );
    }
    if (/^[a-f0-9]{64}$/i.test(target)) await load(target);
    if (address) setWallet(await walletInfo(address));
    setNotice(
      `${r.action === "trustline" ? "USDC trustline" : r.action.replaceAll("_", " ")} confirmed. The latest on-chain receipt is shown.`,
    );
    return true;
  };
  const connect = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const a = await connectWallet();
      setAddress(a);
      setWallet(await walletInfo(a));
      setNotice(
        "Wallet connected on Testnet. Check the role and nominated address before signing.",
      );
    } catch (e) {
      setAddress("");
      setWallet(null);
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const act = async (
    method: string,
    args: Parameters<typeof contractAction>[3],
    expected: string,
    cost = 0n,
    target = id,
    metadata?: RugMeta,
  ) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("Checking the latest receipt and signing wallet…");
    try {
      if (!address)
        throw new Error(
          "Connect the appropriate Varial / Freighter wallet first.",
        );
      if (method !== "register_receipt") {
        const fresh = await readReceipt(target);
        if (
          method === "buy" &&
          fresh.approved_price !== receipt?.approved_price
        )
          throw new Error(
            "The approved price changed. Refresh and review it before signing.",
          );
      }
      const r = await contractAction(
        target,
        method,
        address,
        args,
        expected,
        cost,
        setNotice,
        notify,
      );
      if (metadata) {
        const local = [
          metadata,
          ...readRegistry().filter((m) => m.id !== target),
        ];
        localStorage.setItem(registryKey, JSON.stringify(local));
        setLibrary((l) => [metadata, ...l.filter((m) => m.id !== target)]);
        setId(target);
        setInput(target);
        window.history.replaceState(null, "", `/${role}?receipt=${target}`);
      }
      await monitor(r, target);
    } catch (e) {
      setRecord(storedAction(target));
      setError(message(e));
      setNotice("");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const refresh = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const latest = storedAction(id);
      if (latest?.status === "pending") await monitor(latest);
      else {
        await load(id);
        setRecord(latest);
        if (address) setWallet(await walletInfo(address));
        setNotice("Refreshed from Stellar testnet.");
      }
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const setupTrustline = async () => {
    if (lock.current || !address) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await addTrustline(
        id || "wallet-setup",
        address,
        setNotice,
        notify,
      );
      await monitor(r, id || "wallet-setup");
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const t = receipt?.terms;
  const settled = !!receipt && finalStages.includes(receipt.stage);
  const pending = record?.status === "pending";
  const available =
    receipt?.stage === "Active" &&
    receipt.approved_price != null &&
    !receipt.ready_for_pickup;
  const chosen = library.find((r) => r.id === id);
  const expected =
    role === "warehouse"
      ? deployment.accounts.warehouse
      : role === "weaver"
        ? receipt?.weaver
        : role === "lender"
          ? t?.lender
          : role === "dealer"
            ? t?.dealer
            : address;
  const correct = !!address && !!expected && address === expected;
  function actionButton(label: string, onClick: () => void, enabled = true) {
    return (
      <button
        className="primary"
        onClick={onClick}
        disabled={busy || loading || pending || !correct || !enabled}
      >
        {busy ? "Please wait…" : pending ? "Awaiting confirmation" : label}
        <span aria-hidden>↗</span>
      </button>
    );
  }
  const selectReceipt = (value: string) => {
    if (!/^[a-f0-9]{64}$/i.test(value)) {
      setError("A receipt ID must contain exactly 64 hexadecimal characters.");
      return;
    }
    window.location.assign(`/${role}?receipt=${value.toLowerCase()}`);
  };
  return (
    <>
      <header className="header">
        <a className="brand" href="/">
          <span className="brand-mark">╬</span> RUG DEALER
        </a>
        <span className="network">
          <i />
          Stellar testnet
        </span>
      </header>
      <nav className="role-nav" aria-label="Demo roles">
        {ROLES.map((r) => (
          <a
            key={r}
            aria-current={role === r ? "page" : undefined}
            href={`/${r}${id ? "?receipt=" + id : ""}`}
          >
            {r[0].toUpperCase() + r.slice(1)}
          </a>
        ))}
      </nav>
      <main>
        <div className="eyebrow breadcrumb">
          THE WAREHOUSE COLLECTION / {role.toUpperCase()} DESK
        </div>
        <section className="receipt-library">
          <label htmlFor="rug-select">Demo receipt</label>
          <select
            id="rug-select"
            value={library.some((r) => r.id === id) ? id : ""}
            onChange={(e) => selectReceipt(e.target.value)}
            disabled={busy}
          >
            <option value="">Choose a prepared or registered rug</option>
            {library.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.scenario || short(r.id)}
              </option>
            ))}
          </select>
          <span>Financial state is always read from the contract.</span>
        </section>
        <section className="hero">
          <div className="rug-panel">
            <div className="art-tag">
              <span>WAREHOUSE RUG / {role.toUpperCase()}</span>
              <span>FINISHED. HELD. VERIFIED.</span>
            </div>
            <img
              className="rug-art"
              src="/rug.svg"
              alt="Illustrative terracotta and indigo rug with a geometric medallion"
            />
            <div className="art-caption">
              <span>
                A little more time.
                <br />A fairer price for its maker.
              </span>
              <span className="caption-note">
                Illustrative pattern
                <br />
                Testnet demo
              </span>
            </div>
          </div>
          <div className="purchase-panel">
            <div className="eyebrow">
              {chosen?.name || "ONE RUG, ONE RECEIPT"}
            </div>
            <h1>
              {titles[role][0]}
              <br />
              <em>{titles[role][1]}</em>
            </h1>
            <p className="intro">
              {chosen?.description ||
                "Separate wallets, clear terms, and a warehouse-held rug. Payments settle on Stellar testnet; custody and handoff stay with the warehouse."}
            </p>
            <div className="status-row">
              <span className="badge">
                {loading
                  ? "Reading live receipt…"
                  : receipt
                    ? receipt.stage === "Overdue"
                      ? "Overdue · awaiting payment"
                      : receipt.stage
                    : "No receipt selected"}
              </span>
              <span className="live">
                {receipt ? "● Live on Stellar" : "Testnet only"}
              </span>
            </div>
            <div className="wallet-controls">
              <button className="text-button" onClick={connect} disabled={busy}>
                {address
                  ? "Reconnect / change wallet"
                  : "Connect Varial / Freighter"}{" "}
                ↗
              </button>
              {address && (
                <>
                  <p className="address">Connected: {address}</p>
                  <p>
                    {wallet
                      ? `${units(wallet.balance)} test USDC · ${wallet.xlm} test XLM`
                      : "Checking wallet…"}
                  </p>
                </>
              )}
            </div>
            {expected && role !== "buyer" && (
              <p className="signing-note address">
                This role requires {expected}
                {address && !correct
                  ? " · Switch your wallet and reconnect."
                  : ""}
              </p>
            )}
            {address && wallet && (!wallet.funded || !wallet.trustline) && (
              <div className="notice">
                <p>
                  {!wallet.funded
                    ? "First fund this Testnet account with test XLM."
                    : "Add the Circle testnet USDC trustline before receiving test USDC."}
                </p>
                {!wallet.funded ? (
                  <a
                    href={`https://friendbot.stellar.org/?addr=${address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Get free test XLM ↗
                  </a>
                ) : (
                  <button onClick={setupTrustline} disabled={busy || pending}>
                    Review & approve USDC trustline
                  </button>
                )}
                <p className="address">USDC issuer: {deployment.issuer}</p>
                <p>
                  After adding the trustline, fund with test USDC and refresh.
                  The trustline action does not buy tokens.
                </p>
              </div>
            )}
            {address &&
              wallet?.trustline &&
              wallet.balance < 15n * 10000000n && (
                <p className="signing-note">
                  Need demo funds? Receive Circle testnet USDC at your connected
                  address, or use{" "}
                  <a
                    href="https://faucet.circle.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Circle’s test faucet
                  </a>
                  . Refresh after funding. The required amount depends on your
                  action below.
                </p>
              )}
            {receipt && t && (
              <>
                <div className="terms-summary">
                  <h2>Accepted financing terms</h2>
                  <dl>
                    {[
                      ["Advance", units(t.advance) + " test USDC"],
                      ["Lender repayment", units(t.lender_due) + " test USDC"],
                      [
                        "Warehouse custody",
                        units(t.custody_fee) + " test USDC",
                      ],
                      [
                        "Dealer fallback",
                        units(t.fallback_price) + " test USDC",
                      ],
                      [
                        "Loan duration",
                        t.duration_secs.toString() + " seconds",
                      ],
                      [
                        "Dealer commitment",
                        receipt.dealer_committed
                          ? settled
                            ? "Accepted before funding"
                            : "Accepted · fallback payment still required"
                          : "Awaiting dealer authorization",
                      ],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="address">
                    Lender: {t.lender}
                    <br />
                    Dealer: {t.dealer}
                  </p>
                </div>
                <div
                  className={
                    receipt.stage === "Overdue" ? "notice overdue" : "notice"
                  }
                >
                  <strong>
                    {receipt.deadline
                      ? `Deadline: ${new Date(Number(receipt.deadline) * 1000).toISOString()}`
                      : "Deadline starts only when funding succeeds."}
                  </strong>
                  <p>
                    {receipt.deadline
                      ? receipt.stage === "Overdue"
                        ? "Overdue. Pickup remains locked until the weaver repays or the committed dealer pays."
                        : settled
                          ? "This loan is settled. Pickup rights are recorded below."
                          : `${Math.max(0, Number(receipt.deadline) - clock)} seconds remaining at the last ledger read.`
                      : `Agreed duration: ${t.duration_secs.toString()} seconds from funding.`}
                  </p>
                </div>
              </>
            )}
            {role === "warehouse" && (
              <form
                className="role-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  try {
                    const target = newReceiptId();
                    act(
                      "register_receipt",
                      [addressValue(weaver)],
                      deployment.accounts.warehouse,
                      0n,
                      target,
                      { id: target, name, description },
                    );
                  } catch (error) {
                    setError(message(error));
                  }
                }}
              >
                <h2>Register a rug in custody</h2>
                <label>
                  Rug name{" "}
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={100}
                  />
                </label>
                <label>
                  Description (display only)
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={500}
                  />
                </label>
                <label>
                  Weaver wallet
                  <input
                    value={weaver}
                    onChange={(e) => setWeaver(e.target.value)}
                    required
                    pattern="G[A-Z2-7]{55}"
                  />
                </label>
                <p className="signing-note">
                  By signing, the configured warehouse confirms it physically
                  holds this rug. A fresh receipt ID will be generated.
                </p>
                <button
                  className="primary"
                  type="submit"
                  disabled={busy || pending || !correct}
                >
                  Confirm custody & register rug ↗
                </button>
              </form>
            )}
            {role === "weaver" && receipt?.stage === "Held" && (
              <form
                className="role-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  try {
                    const accepted: Terms = {
                      advance: parseAmount(draft.advance),
                      lender_due: parseAmount(draft.lender_due),
                      custody_fee: parseAmount(draft.custody_fee),
                      fallback_price: parseAmount(draft.fallback_price),
                      duration_secs: BigInt(draft.duration_secs),
                      lender: draft.lender,
                      dealer: draft.dealer,
                    };
                    act("accept_terms", [termsValue(accepted)], receipt.weaver);
                  } catch (e) {
                    setError(message(e));
                  }
                }}
              >
                <h2>Review the complete loan terms</h2>
                <p>
                  These terms become fixed after your signature. The dealer must
                  authorize the same terms before the lender can fund.
                </p>
                {Object.entries(draft).map(([key, value]) => (
                  <label key={key}>
                    {
                      (
                        {
                          advance: "Advance (test USDC)",
                          lender_due: "Lender repayment (test USDC)",
                          custody_fee: "Custody fee (test USDC)",
                          fallback_price: "Fallback price (test USDC)",
                          duration_secs: "Duration (seconds, 30–86400)",
                          lender: "Nominated lender wallet",
                          dealer: "Nominated dealer wallet",
                        } as Record<string, string>
                      )[key]
                    }
                    <input
                      value={value}
                      required
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [key]: e.target.value }))
                      }
                    />
                  </label>
                ))}
                <button
                  className="primary"
                  type="submit"
                  disabled={busy || pending || !correct}
                >
                  Accept these exact terms ↗
                </button>
              </form>
            )}
            {role === "weaver" &&
              receipt &&
              ["Active", "Overdue"].includes(receipt.stage) &&
              t && (
                <div className="role-form">
                  {receipt.stage === "Active" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        try {
                          act(
                            "approve_sale",
                            [amountValue(parseAmount(salePrice))],
                            receipt.weaver,
                          );
                        } catch (e) {
                          setError(message(e));
                        }
                      }}
                    >
                      <h2>Approve a sale price</h2>
                      <label>
                        Price (test USDC)
                        <input
                          value={salePrice}
                          onChange={(e) => setSalePrice(e.target.value)}
                          required
                        />
                      </label>
                      <button
                        className="primary"
                        type="submit"
                        disabled={busy || pending || !correct}
                      >
                        Approve sale price ↗
                      </button>
                    </form>
                  )}
                  <h2>Repay and reclaim your rug</h2>
                  <p>
                    Pay {units(t.lender_due + t.custody_fee)} test USDC: lender{" "}
                    {units(t.lender_due)} + custody {units(t.custody_fee)}.
                    Repayment remains available after the deadline until
                    settlement.
                  </p>
                  {actionButton(
                    `Repay ${units(t.lender_due + t.custody_fee)} test USDC`,
                    () =>
                      act(
                        "repay",
                        [],
                        receipt.weaver,
                        t.lender_due + t.custody_fee,
                      ),
                  )}
                </div>
              )}
            {role === "dealer" && t && receipt && (
              <div className="role-form">
                <h2>Fallback purchase commitment</h2>
                <p>
                  Commit to pay {units(t.fallback_price)} test USDC for this rug
                  after the deadline. This signature is a promise, not escrow or
                  automatic payment. No lender payout or pickup clearance occurs
                  until payment succeeds.
                </p>
                {receipt.stage === "TermsAccepted" &&
                  !receipt.dealer_committed &&
                  actionButton("Accept this exact fallback commitment", () =>
                    act("accept_fallback", [termsValue(t)], t.dealer),
                  )}
                {["Active", "Overdue"].includes(receipt.stage) &&
                  actionButton(
                    `Pay fallback price · ${units(t.fallback_price)} test USDC`,
                    () => act("dealer_buy", [], t.dealer, t.fallback_price),
                    receipt.stage === "Overdue",
                  )}
                <p className="signing-note">
                  {receipt.stage === "Active"
                    ? "Wait until the ledger deadline. The weaver may repay first."
                    : receipt.stage === "Overdue"
                      ? "Your purchase pays the lender and warehouse; any surplus goes to the weaver."
                      : ""}
                </p>
              </div>
            )}
            {role === "lender" && t && receipt && (
              <div className="role-form">
                <h2>Inspect before funding</h2>
                <p>
                  Warehouse custody: confirmed by registration. Weaver terms:
                  accepted. Dealer:{" "}
                  {receipt.dealer_committed
                    ? "authorized the exact fallback commitment"
                    : "has not committed yet"}
                  .
                </p>
                <p>
                  Advance {units(t.advance)} test USDC to the weaver.{" "}
                  {units(t.lender_due)} is due to you; {units(t.custody_fee)} is
                  the separate warehouse fee. The deadline starts when this
                  payment succeeds.
                </p>
                {actionButton(
                  `Fund ${units(t.advance)} test USDC advance`,
                  () => act("fund_loan", [], t.lender, t.advance),
                  receipt.stage === "TermsAccepted" && receipt.dealer_committed,
                )}
                <p className="signing-note">
                  The dealer promise is not a payment guarantee. If overdue,
                  settlement still requires the weaver or dealer to pay.
                </p>
              </div>
            )}
            {role === "buyer" && (
              <>
                <div className="price-block">
                  <span className="eyebrow">WEAVER-APPROVED PRICE</span>
                  <div className="price">
                    {receipt?.approved_price != null
                      ? units(receipt.approved_price)
                      : "—"}{" "}
                    <span>test USDC</span>
                  </div>
                  <p>Test tokens only. Network fees are separate test XLM.</p>
                </div>
                {receipt?.approved_price != null && t && (
                  <div className="split">
                    <div>
                      <span>Lender repayment</span>
                      <strong>{units(t.lender_due)} USDC</strong>
                    </div>
                    <div>
                      <span>Warehouse custody</span>
                      <strong>{units(t.custody_fee)} USDC</strong>
                    </div>
                    <div>
                      <span>To the weaver</span>
                      <strong>
                        {units(
                          receipt.approved_price - t.lender_due - t.custody_fee,
                        )}{" "}
                        USDC
                      </strong>
                    </div>
                  </div>
                )}
                {!settled &&
                  actionButton(
                    `Review & pay ${receipt?.approved_price ? units(receipt.approved_price) : "—"} test USDC`,
                    () =>
                      receipt?.approved_price != null &&
                      act(
                        "buy",
                        [
                          addressValue(address),
                          amountValue(receipt.approved_price),
                        ],
                        address,
                        receipt.approved_price,
                      ),
                    !!available,
                  )}
                {receipt?.stage === "Overdue" && (
                  <p className="notice">
                    Normal sale has closed. The weaver may repay or the
                    committed dealer may purchase.
                  </p>
                )}
              </>
            )}
            {!address && (
              <p className="signing-note">
                Connect the correct wallet to authorize an action. Changing role
                pages never changes signing authority.
              </p>
            )}
            {receipt?.stage === "Held" && role !== "weaver" && (
              <p className="notice">
                Next: the weaver reviews and accepts the financing terms.
              </p>
            )}
            {settled && (
              <p className="notice">
                Settlement complete. This receipt cannot back another loan.
                Pickup recipient:{" "}
                <span className="address">{receipt?.pickup_recipient}</span>
              </p>
            )}
            <div
              role="status"
              aria-live="polite"
              className={notice ? "notice" : ""}
            >
              {notice}
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {record && (
              <a
                className="transaction"
                href={txLink(record.hash)}
                target="_blank"
                rel="noreferrer"
              >
                {record.action.replaceAll("_", " ")} · {record.status} ↗{" "}
                <code>{record.hash}</code>
              </a>
            )}
            <button className="text-button" onClick={refresh} disabled={busy}>
              Refresh status ↻
            </button>
          </div>
        </section>
        <section className="receipt-section">
          <div>
            <div className="eyebrow">THE WAREHOUSE RECORD</div>
            <h2>A receipt you can read.</h2>
            <p>
              Every payout must succeed before pickup is cleared. The warehouse
              handles the physical handoff.
            </p>
          </div>
          <dl>
            {[
              ["Receipt status", receipt?.stage || "—"],
              [
                "Custody",
                receipt ? "Warehouse attestation registered" : "Not loaded",
              ],
              ["Recorded purchaser", receipt?.buyer || "Not recorded"],
              ["Pickup recipient", receipt?.pickup_recipient || "Not assigned"],
              [
                "Pickup status",
                receipt
                  ? receipt.ready_for_pickup
                    ? "Ready for pickup"
                    : "Locked · awaiting settlement"
                  : "—",
              ],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd
                  className={
                    k.includes("recipient") || k.includes("purchaser")
                      ? "address"
                      : ""
                  }
                >
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <details className="details">
          <summary>Receipt library & contract details</summary>
          <p>
            Names, descriptions, and this illustration are display metadata.
            Local metadata is browser-specific and can be lost when storage is
            cleared; it is never financial truth.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              selectReceipt(input);
            }}
          >
            <label htmlFor="receipt">Receipt ID</label>
            <div className="receipt-input">
              <input
                id="receipt"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                spellCheck={false}
              />
              <button type="submit" disabled={busy}>
                Load receipt
              </button>
            </div>
          </form>
          <button
            className="text-button"
            onClick={() =>
              navigator.clipboard
                .writeText(JSON.stringify(library, null, 2))
                .then(() => setNotice("Public receipt library copied."))
            }
          >
            Copy receipt library
          </button>
          <p>
            Contract{" "}
            <a
              className="address"
              href={`https://lab.stellar.org/r/testnet/contract/${CONTRACT}`}
              target="_blank"
              rel="noreferrer"
            >
              {CONTRACT} ↗
            </a>
          </p>
          <p>
            Full API:{" "}
            <a
              href="https://github.com/Flowisgo/rug-dealer/blob/codex/full-loan-demo/docs/full-demo-api.md"
              target="_blank"
              rel="noreferrer"
            >
              Contract reference ↗
            </a>
          </p>
        </details>
      </main>
      <footer>
        <span className="brand">RUG DEALER</span>
        <span>More time for weavers. Clear terms for everyone.</span>
        <span>STELLAR HACKATHON / TESTNET PROTOTYPE</span>
      </footer>
    </>
  );
}
