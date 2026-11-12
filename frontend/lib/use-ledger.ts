"use client";
// One shared snapshot of the contract for every screen: config, rugs, loans,
// stores and events. Cached for a few seconds and refreshed after each action.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { server, getConfig, listLoans, listRugs, listStores, usdcBalance, type Config, type Loan, type Rug, type Store } from "./contract";
import { fetchEvents, type AppEvent } from "./events";
import { messageOf } from "./errors";
import { forgetHandedOver } from "./handover";

export type Ledger = {
  config: Config;
  rugs: Rug[];
  loans: Loan[];
  stores: Store[];
  events: AppEvent[];
  eventsTrimmed: boolean;
  eventsError: string | null;
  frozenReason: Record<string, "Platform" | "MissedBuyout">;
  loadedAt: number;
};

type State = { data: Ledger | null; error: string | null; loading: boolean };

let state: State = { data: null, error: null, loading: false };
let inflight: Promise<void> | null = null;
const requestedStores = new Set<string>();
const listeners = new Set<() => void>();
const set = (s: Partial<State>) => {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
};

async function load(): Promise<void> {
  set({ loading: true });
  try {
    const [config, rugs, loans, ev] = await Promise.all([
      getConfig(),
      listRugs(),
      listLoans(),
      fetchEvents().then(
        (r) => ({ ...r, error: null as string | null }),
        (e) => ({ events: [] as AppEvent[], trimmed: false, error: messageOf(e) }),
      ),
    ]);
    // A rug that has been handed over needs no saved hand-over code any more.
    forgetHandedOver(rugs);
    const seen = new Set<string>();
    const frozenReason: Ledger["frozenReason"] = {};
    for (const e of ev.events) {
      if (e.kind === "store_registered") seen.add(e.store);
      if (e.kind === "store_frozen" && !frozenReason[e.store]) frozenReason[e.store] = e.reason;
    }
    rugs.forEach((r) => seen.add(r.store));
    loans.forEach((l) => seen.add(l.store));
    const stores = await listStores([...seen, ...requestedStores]);
    set({
      data: {
        config,
        rugs,
        loans,
        stores,
        events: ev.events,
        eventsTrimmed: ev.trimmed,
        eventsError: ev.error,
        frozenReason,
        loadedAt: Date.now(),
      },
      error: null,
      loading: false,
    });
  } catch (e) {
    set({ error: messageOf(e), loading: false });
  }
}

export function refreshLedger(): Promise<void> {
  if (!inflight) inflight = load().finally(() => (inflight = null));
  return inflight;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;
const SERVER_STATE: State = { data: null, error: null, loading: true };
const serverSnapshot = (): State => SERVER_STATE;

/** The shared contract snapshot. Reloads when stale (older than 20 s) and
 * every 20 s while the tab is visible. */
export function useLedger(storeAddress: string | null = null) {
  useEffect(() => {
    if (storeAddress && !requestedStores.has(storeAddress)) {
      requestedStores.add(storeAddress);
      void refreshLedger().then(() => {
        if (!state.data?.stores.some((s) => s.address === storeAddress)) void refreshLedger();
      });
    }
  }, [storeAddress]);
  const s = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    if (!state.data || Date.now() - state.data.loadedAt > 20_000) void refreshLedger();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refreshLedger();
    }, 20_000);
    return () => clearInterval(t);
  }, []);
  const refresh = useCallback(() => refreshLedger(), []);
  return { ...s, refresh };
}

// A shared clock sampled from closed ledgers. Never extrapolate from the
// browser clock: a fast laptop must not enable a premature claim.
let closedAt = 0n;
let clockTimer: ReturnType<typeof setInterval> | null = null;
let clockRequest: Promise<void> | null = null;
const clockListeners = new Set<() => void>();
async function readClock() {
  try {
    const latest = await server().getLatestLedger();
    const page = await server().getLedgers({ startLedger: latest.sequence, pagination: { limit: 1 } });
    closedAt = BigInt(page.ledgers[0].ledgerCloseTime);
  } catch { closedAt = 0n; }
  clockListeners.forEach(l => l());
}
function updateClock() {
  if (!clockRequest) clockRequest = readClock().finally(() => { clockRequest = null; });
  return clockRequest;
}
const subscribeClock = (listener: () => void) => {
  clockListeners.add(listener);
  if (!clockTimer) { void updateClock(); clockTimer = setInterval(updateClock, 5000); }
  return () => {
    clockListeners.delete(listener);
    if (!clockListeners.size && clockTimer) { clearInterval(clockTimer); clockTimer = null; closedAt = 0n; }
  };
};
/** Last confirmed ledger timestamp, or zero while unavailable. Signing still
 * simulates against the current ledger before opening the wallet. */
export function useNow(): bigint {
  return useSyncExternalStore(subscribeClock, () => closedAt, () => 0n);
}

/** Any account's USDC balance (public data). undefined while loading, null
 * when the account can't hold USDC. Re-reads when the ledger refreshes. */
export function useBalance(address: string | null): bigint | null | undefined {
  const [bal, setBal] = useState<bigint | null | undefined>(undefined);
  const loadedAt = useSyncExternalStore(subscribe, () => state.data?.loadedAt ?? 0, () => 0);
  useEffect(() => {
    if (!address) return setBal(undefined);
    let alive = true;
    usdcBalance(address).then((b) => alive && setBal(b), () => alive && setBal(undefined));
    return () => {
      alive = false;
    };
  }, [address, loadedAt]);
  return bal;
}
