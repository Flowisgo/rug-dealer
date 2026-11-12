"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { usdcBalance, type BalanceState } from "@/lib/contract";
import { DEMO_NAMES, FRIENDBOT_URL } from "@/lib/deployment";
import { messageOf } from "@/lib/errors";
import { addUsdcTrustline } from "@/lib/tx";
import { connect, currentAddress, freighterInstalled, onTestnet, short } from "@/lib/wallet";
import { MoneyBlock } from "./money";

type Wallet = {
  address: string | null;
  installed: boolean | null;
  testnet: boolean | null;
  balance: BalanceState; // undefined = loading, null = can't hold USDC, "unavailable" = couldn't read
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  forget: () => void;
  refreshBalance: () => void;
};

const Ctx = createContext<Wallet | null>(null);
const FORGET_KEY = "rugdealer:forget-wallet";

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [testnet, setTestnet] = useState<boolean | null>(null);
  const [balance, setBalance] = useState<BalanceState>(undefined);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readBalance = useCallback((a: string | null) => {
    if (!a) return setBalance(undefined);
    setBalance(undefined);
    usdcBalance(a).then(setBalance, () => setBalance("unavailable"));
  }, []);

  // Restore a previous connection and follow account switches in Varial.
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const has = await freighterInstalled();
      if (!alive) return;
      setInstalled(has);
      if (!has) return;
      let forgotten = false;
      try {
        forgotten = localStorage.getItem(FORGET_KEY) === "1";
      } catch {}
      if (forgotten) return;
      const a = await currentAddress();
      if (!alive) return;
      setAddress((prev) => (prev === a ? prev : a));
      if (a) setTestnet(await onTestnet().catch(() => null));
    };
    void check();
    const t = setInterval(check, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => readBalance(address), [address, readBalance]);

  const doConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const a = await connect();
      try {
        localStorage.removeItem(FORGET_KEY);
      } catch {}
      setAddress(a);
      setTestnet(true);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const forget = useCallback(() => {
    try {
      localStorage.setItem(FORGET_KEY, "1");
    } catch {}
    setAddress(null);
  }, []);

  return (
    <Ctx.Provider
      value={{
        address,
        installed,
        testnet,
        balance,
        connecting,
        error,
        connect: doConnect,
        forget,
        refreshBalance: () => readBalance(address),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useWallet(): Wallet {
  const w = useContext(Ctx);
  if (!w) throw new Error("useWallet outside WalletProvider");
  return w;
}


export function WalletChip() {
  const w = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!w.address) {
    return (
      <div className="wallet">
        <button className="btn" onClick={() => void w.connect()} disabled={w.connecting}>
          {w.connecting ? "Connecting…" : "Connect wallet"}
        </button>
        {w.error && (
          <div className="wallet-menu" role="alert">
            <span className="error-text">{w.error}</span>
          </div>
        )}
      </div>
    );
  }

  const demo = DEMO_NAMES[w.address];
  const addUsdc = async () => {
    setErr(null);
    try {
      await addUsdcTrustline(w.address!, (s) => setBusy(s));
      w.refreshBalance();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="wallet">
      <summary className="wallet-chip" aria-label="Wallet">
        <span className="who">{demo ? demo.name : "Your wallet"}</span>
        <span className="addr">{short(w.address)}</span>
        <span className="bal">
          {w.testnet === false ? (
            <span className="error-text">Not on Testnet</span>
          ) : w.balance === undefined ? (
            <span className="muted">…</span>
          ) : w.balance === null ? (
            <span className="muted">No USDC yet</span>
          ) : w.balance === "unavailable" ? (
            <span className="muted">Balance unavailable</span>
          ) : (
            <MoneyBlock units={w.balance} />
          )}
        </span>
      </summary>
      <div className="wallet-menu">
        <div>
          <div className="small muted">Connected account</div>
          <div className="mono">{w.address}</div>
        </div>
        {w.testnet === false && (
          <p className="error-text">Varial is on another network. Switch it to Testnet; this demo never uses real money.</p>
        )}
        {w.balance === null && (
          <>
            <p>This wallet can't hold test USDC yet. Add USDC first (needs a little test XLM for the fee).</p>
            <div className="btn-row">
              <button className="btn" onClick={() => void addUsdc()} disabled={!!busy}>
                {busy ? "Working…" : "Add USDC to wallet"}
              </button>
              <a className="small" href={`${FRIENDBOT_URL}/?addr=${w.address}`} target="_blank" rel="noreferrer">
                Get test XLM
              </a>
            </div>
          </>
        )}
        {err && <p className="error-text">{err}</p>}
        <div className="btn-row">
          <button
            className="btn btn-quiet"
            onClick={() => {
              void navigator.clipboard?.writeText(w.address!).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy address"}
          </button>
          <button className="btn btn-quiet" onClick={w.refreshBalance}>
            Refresh balance
          </button>
          <button className="btn btn-quiet" onClick={w.forget}>
            Disconnect
          </button>
        </div>
      </div>
    </details>
  );
}
