"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONTRACT,
  DEMO_RECEIPT,
  Purchase,
  Receipt,
  Terms,
  awaitConfirmation,
  connectWallet,
  purchaseRug,
  readBalance,
  readReceipt,
  readTerms,
  storageKey,
  txLink,
  units,
} from "../lib/stellar";

const short = (value: string) => `${value.slice(0, 7)}…${value.slice(-6)}`;
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
export default function RugPage() {
  const [id, setId] = useState("");
  const [input, setInput] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  const load = useCallback(async (receiptId: string) => {
    const [next, nextTerms] = await Promise.all([
      readReceipt(receiptId),
      readTerms(),
    ]);
    setReceipt(next);
    setTerms(nextTerms);
    return next;
  }, []);
  useEffect(() => {
    const receiptId =
      new URL(window.location.href).searchParams.get("receipt") || DEMO_RECEIPT;
    setId(receiptId);
    setInput(receiptId);
    try {
      const stored = JSON.parse(
        localStorage.getItem(storageKey(receiptId)) || "null",
      );
      if (
        stored &&
        /^[a-f0-9]{64}$/.test(stored.hash) &&
        ["pending", "confirmed", "failed"].includes(stored.status)
      )
        setPurchase(stored);
    } catch {
      /* An invalid local record must never prevent a live receipt read. */
    }
    load(receiptId)
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false));
  }, [load]);
  const savePurchase = (value: Purchase) => {
    setPurchase(value);
    localStorage.setItem(storageKey(id), JSON.stringify(value));
  };
  const confirm = async (hash: string) => {
    setNotice("Submitted. Waiting for network confirmation…");
    const status = await awaitConfirmation(hash);
    savePurchase({ hash, status });
    if (status === "failed")
      throw new Error(
        "The purchase failed on-chain. Refresh the receipt before trying again.",
      );
    if (status === "pending") {
      setNotice(
        "Still awaiting confirmation. Use “Refresh status” to check again; do not submit another purchase.",
      );
      return;
    }
    setNotice("Transaction confirmed. Refreshing the warehouse receipt…");
    const next = await load(id);
    if (address) setBalance(await readBalance(address));
    setNotice(
      next.stage === "Settled" && next.ready_for_pickup
        ? "Purchase confirmed. Your rug is cleared for pickup."
        : "Transaction confirmed. The latest receipt is shown below.",
    );
  };
  const connect = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("Opening Freighter…");
    try {
      const account = await connectWallet();
      setAddress(account);
      setBalance(await readBalance(account));
      setNotice(
        "Wallet connected on Stellar testnet. Review the approved price before signing.",
      );
    } catch (e) {
      setAddress("");
      setBalance(null);
      setError(message(e));
      setNotice("");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const buy = async () => {
    if (
      lock.current ||
      !receipt?.approved_price ||
      !address ||
      purchase?.status === "pending" ||
      purchase?.status === "confirmed"
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const hash = await purchaseRug(
        id,
        address,
        receipt.approved_price,
        setNotice,
      );
      savePurchase({ hash, status: "pending" });
      await confirm(hash);
    } catch (e) {
      // Recover the hash even if submission timed out after reaching the network.
      const stored = localStorage.getItem(storageKey(id));
      if (stored) setPurchase(JSON.parse(stored));
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
      if (purchase?.status === "pending") await confirm(purchase.hash);
      else {
        await load(id);
        if (address) setBalance(await readBalance(address));
        setNotice("Receipt refreshed from Stellar testnet.");
      }
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const price = receipt?.approved_price;
  const settled = receipt?.stage === "Settled";
  const available =
    receipt?.stage === "Active" &&
    price !== null &&
    price !== undefined &&
    !receipt.ready_for_pickup;
  const canBuy =
    available &&
    !!address &&
    balance !== null &&
    price !== undefined &&
    price !== null &&
    balance >= price &&
    !busy &&
    purchase?.status !== "pending" &&
    purchase?.status !== "confirmed";
  return (
    <>
      <header className="header">
        <a className="brand" href="/" aria-label="Rug Dealer home">
          <span className="brand-mark">╬</span> RUG DEALER
        </a>
        <span className="network">
          <i /> Stellar testnet
        </span>
      </header>
      <main>
        <div className="eyebrow breadcrumb">
          THE WAREHOUSE COLLECTION <span> / </span> ONE RUG, ONE RECEIPT
        </div>
        <section className="hero">
          <div className="rug-panel">
            <div className="art-tag">
              <span>01 / WAREHOUSE RUG</span>
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
            <div className="eyebrow">FROM THE WEAVER, WITH TIME</div>
            <h1>
              A rug worth
              <br />
              <em>waiting for.</em>
            </h1>
            <p className="intro">
              Your purchase settles the weaver’s loan and clears a finished rug
              for collection from the warehouse.
            </p>
            <div className="status-row">
              <span className={`badge ${settled ? "settled" : ""}`}>
                {loading
                  ? "Reading live receipt…"
                  : settled
                    ? "Sale settled"
                    : available
                      ? "Available for purchase"
                      : receipt
                        ? "Not available for purchase"
                        : "Receipt unavailable"}
              </span>
              <span className="live">● Live on Stellar</span>
            </div>
            <div className="price-block">
              <span className="eyebrow">WEAVER-APPROVED PRICE</span>
              <div className="price">
                {price !== null && price !== undefined ? units(price) : "—"}{" "}
                <span>test USDC</span>
              </div>
              <p>
                Test tokens only. Network fees are paid separately in test XLM.
              </p>
            </div>
            {terms && price !== null && price !== undefined && (
              <div className="split">
                <div>
                  <span>Lender repayment</span>
                  <strong>{units(terms.lender_due)} USDC</strong>
                </div>
                <div>
                  <span>Warehouse custody</span>
                  <strong>{units(terms.custody_fee)} USDC</strong>
                </div>
                <div>
                  <span>To the weaver</span>
                  <strong>
                    {units(price - terms.lender_due - terms.custody_fee)} USDC
                  </strong>
                </div>
              </div>
            )}
            {address && (
              <div className="wallet">
                <span>
                  Buyer wallet <strong title={address}>{short(address)}</strong>{" "}
                  <button
                    className="wallet-change"
                    onClick={connect}
                    disabled={busy}
                  >
                    Change wallet
                  </button>
                </span>
                <span>
                  {balance === null
                    ? "Checking balance…"
                    : `${units(balance)} test USDC available`}
                </span>
              </div>
            )}
            {!settled && (
              <button
                className="primary"
                onClick={address ? buy : connect}
                disabled={busy || loading || (!address ? !available : !canBuy)}
              >
                {busy
                  ? "Please wait…"
                  : !address
                    ? "Connect Freighter"
                    : purchase?.status === "pending"
                      ? "Awaiting confirmation"
                      : purchase?.status === "confirmed"
                        ? "Transaction confirmed"
                        : `Review & pay ${price ? units(price) : "—"} test USDC`}
                <span aria-hidden>↗</span>
              </button>
            )}
            {address &&
              available &&
              balance !== null &&
              price !== null &&
              price !== undefined &&
              balance < price && (
                <p className="balance-warning">
                  This wallet needs at least {units(price)} test USDC. Fund its
                  Circle testnet USDC balance, then refresh.
                </p>
              )}
            {!settled && (
              <p className="signing-note">
                {address
                  ? "Review the transaction in Freighter. Signing authorizes the exact approved price above."
                  : "Connect your wallet on Testnet. You’ll review the price again before signing."}
              </p>
            )}
            <div
              aria-live="polite"
              role="status"
              className={notice ? "notice" : ""}
            >
              {notice}
            </div>
            {error && (
              <div className="error" role="alert">
                {error}{" "}
                {error.includes("Freighter is not available") && (
                  <a
                    href="https://www.freighter.app/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Get Freighter ↗
                  </a>
                )}
              </div>
            )}
            {purchase && (
              <a
                className="transaction"
                href={txLink(purchase.hash)}
                target="_blank"
                rel="noreferrer"
              >
                {purchase.status === "confirmed"
                  ? "Confirmed transaction"
                  : purchase.status === "failed"
                    ? "Failed transaction"
                    : "Submitted transaction"}{" "}
                ↗ <code>{short(purchase.hash)}</code>
              </a>
            )}
            <button
              className="text-button"
              onClick={refresh}
              disabled={busy || !id}
            >
              Refresh status ↻
            </button>
          </div>
        </section>
        <section className="receipt-section">
          <div>
            <div className="eyebrow">THE WAREHOUSE RECORD</div>
            <h2>A receipt you can read.</h2>
            <p>
              Pickup is cleared only after every payout succeeds. The warehouse
              handles the physical handoff.
            </p>
          </div>
          <dl>
            <div>
              <dt>Receipt status</dt>
              <dd>{receipt?.stage || "—"}</dd>
            </div>
            <div>
              <dt>Recorded buyer</dt>
              <dd className="address">
                {receipt?.buyer || "Not recorded yet"}
              </dd>
            </div>
            <div>
              <dt>Pickup status</dt>
              <dd className={receipt?.ready_for_pickup ? "green" : ""}>
                {receipt
                  ? receipt.ready_for_pickup
                    ? "Ready for pickup"
                    : "Locked · awaiting settlement"
                  : "—"}
              </dd>
            </div>
          </dl>
        </section>
        <details className="details">
          <summary>Receipt & contract details</summary>
          <p>
            Load a warehouse receipt by its 64-character ID. Price and status
            always come from the deployed testnet contract.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (/^[a-f0-9]{64}$/i.test(input))
                window.location.assign(`/?receipt=${input.toLowerCase()}`);
              else
                setError(
                  "Use a receipt ID with exactly 64 hexadecimal characters.",
                );
            }}
          >
            <label htmlFor="receipt">Receipt ID</label>
            <div className="receipt-input">
              <input
                id="receipt"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                spellCheck={false}
              />
              <button type="submit" disabled={busy}>
                Load receipt
              </button>
            </div>
          </form>
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
            Contract API:{" "}
            <a
              href="https://github.com/Flowisgo/rug-dealer/pull/3"
              target="_blank"
              rel="noreferrer"
            >
              PR #3 ↗
            </a>
          </p>
        </details>
      </main>
      <footer>
        <span className="brand">RUG DEALER</span>
        <span>More time for weavers. A direct path for buyers.</span>
        <span>STELLAR HACKATHON / TESTNET PROTOTYPE</span>
      </footer>
    </>
  );
}
