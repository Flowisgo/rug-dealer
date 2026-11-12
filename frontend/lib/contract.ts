// Typed wrappers around the RugDealer contract. Every read is a simulation:
// no signature, no fee, nothing submitted.
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { ACCOUNTS, CONTRACT_ID, KNOWN_STORES, NETWORK_PASSPHRASE, RPC_URL, USDC_ID } from "./deployment";
import { explainError } from "./errors";
import type { Quote } from "./money";

export type RugStatus = "Free" | "Requested" | "Locked" | "Redeemed";
export type LoanStatus = "Requested" | "Funded" | "Cancelled" | "Repaid" | "BoughtOut" | "Claimed";

export type Config = {
  admin: string;
  usdc: string;
  fee_recipient: string;
  interest_bps_per_year: number;
  platform_fee_bps: number;
  store_fee_bps_per_month: number;
  max_months: number;
  month_seconds: bigint;
  buyout_window_seconds: bigint;
};

export type Store = { address: string; limit: bigint; open_principal: bigint; frozen: boolean };

export type Rug = {
  id: bigint;
  store: string;
  description: string;
  price: bigint;
  owner: string;
  status: RugStatus;
};

export type Loan = {
  id: bigint;
  rug_id: bigint;
  store: string;
  weaver: string;
  investor: string | null;
  principal: bigint;
  months: number;
  interest: bigint;
  platform_fee: bigint;
  store_fee: bigint;
  weaver_payout: bigint;
  requested_at: bigint;
  funded_at: bigint | null;
  end_at: bigint | null;
  status: LoanStatus;
};

let _server: rpc.Server | null = null;
export const server = () => (_server ??= new rpc.Server(RPC_URL));

/** Soroban enums come back as ["Variant"]; flatten them. */
export const variant = <T extends string>(v: unknown): T => (Array.isArray(v) ? v[0] : v) as T;
const opt = <T>(v: unknown): T | null => (v === undefined || v === null ? null : (v as T));

export const u64 = (n: bigint | number) => nativeToScVal(BigInt(n), { type: "u64" });
export const u32 = (n: number) => nativeToScVal(n, { type: "u32" });
export const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });
export const addr = (a: string) => new Address(a).toScVal();
export const str = (s: string) => nativeToScVal(s, { type: "string" });

// Any existing account works as the source of a read-only simulation.
const READ_SOURCE = ACCOUNTS.admin;

export async function simulateRead(contractId: string, method: string, args: xdr.ScVal[] = []): Promise<unknown> {
  const tx = new TransactionBuilder(new Account(READ_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server().simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw explainError(sim.error);
  if (!sim.result) throw explainError("");
  return scValToNative(sim.result.retval);
}

const read = (method: string, args: xdr.ScVal[] = []) => simulateRead(CONTRACT_ID, method, args);

// ---- normalizers (exported for tests) ----

export function toConfig(r: Record<string, unknown>): Config {
  return {
    admin: String(r.admin),
    usdc: String(r.usdc),
    fee_recipient: String(r.fee_recipient),
    interest_bps_per_year: Number(r.interest_bps_per_year),
    platform_fee_bps: Number(r.platform_fee_bps),
    store_fee_bps_per_month: Number(r.store_fee_bps_per_month),
    max_months: Number(r.max_months),
    month_seconds: BigInt(r.month_seconds as bigint),
    buyout_window_seconds: BigInt(r.buyout_window_seconds as bigint),
  };
}

export function toStore(r: Record<string, unknown>): Store {
  return {
    address: String(r.address),
    limit: BigInt(r.limit as bigint),
    open_principal: BigInt(r.open_principal as bigint),
    frozen: Boolean(r.frozen),
  };
}

export function toRug(r: Record<string, unknown>): Rug {
  return {
    id: BigInt(r.id as bigint),
    store: String(r.store),
    description: String(r.description),
    price: BigInt(r.price as bigint),
    owner: String(r.owner),
    status: variant<RugStatus>(r.status),
  };
}

export function toLoan(r: Record<string, unknown>): Loan {
  const big = (v: unknown) => (v === undefined || v === null ? null : BigInt(v as bigint));
  return {
    id: BigInt(r.id as bigint),
    rug_id: BigInt(r.rug_id as bigint),
    store: String(r.store),
    weaver: String(r.weaver),
    investor: opt<string>(r.investor),
    principal: BigInt(r.principal as bigint),
    months: Number(r.months),
    interest: BigInt(r.interest as bigint),
    platform_fee: BigInt(r.platform_fee as bigint),
    store_fee: BigInt(r.store_fee as bigint),
    weaver_payout: BigInt(r.weaver_payout as bigint),
    requested_at: BigInt(r.requested_at as bigint),
    funded_at: big(r.funded_at),
    end_at: big(r.end_at),
    status: variant<LoanStatus>(r.status),
  };
}

export function toQuote(r: Record<string, unknown>): Quote {
  return {
    principal: BigInt(r.principal as bigint),
    months: Number(r.months),
    interest: BigInt(r.interest as bigint),
    platform_fee: BigInt(r.platform_fee as bigint),
    store_fee: BigInt(r.store_fee as bigint),
    weaver_payout: BigInt(r.weaver_payout as bigint),
    investor_payout: BigInt(r.investor_payout as bigint),
  };
}

// ---- views ----

export const getConfig = async () => toConfig((await read("get_config")) as Record<string, unknown>);
export const getStore = async (store: string) => toStore((await read("get_store", [addr(store)])) as Record<string, unknown>);
export const getRug = async (id: bigint) => toRug((await read("get_rug", [u64(id)])) as Record<string, unknown>);
export const getLoan = async (id: bigint) => toLoan((await read("get_loan", [u64(id)])) as Record<string, unknown>);
export const nextRugId = async () => BigInt((await read("next_rug_id")) as bigint);
export const nextLoanId = async () => BigInt((await read("next_loan_id")) as bigint);
export const quote = async (principal: bigint, months: number) =>
  toQuote((await read("quote", [i128(principal), u32(months)])) as Record<string, unknown>);

/** Store record, or null when the address is not a registered store. */
export async function findStore(address: string): Promise<Store | null> {
  try {
    return await getStore(address);
  } catch (e) {
    if ((e as { code?: number }).code === 3) return null;
    throw e;
  }
}

/** USDC balance via the token contract. null when the wallet can't hold USDC
 * yet (no trustline) or the account does not exist. */
export async function usdcBalance(address: string): Promise<bigint | null> {
  try {
    return BigInt((await simulateRead(USDC_ID, "balance", [addr(address)])) as bigint);
  } catch {
    return null;
  }
}

/** Run tasks with a small concurrency limit so we don't hammer the RPC. */
export async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return out;
}

const range = (n: bigint) => Array.from({ length: Math.max(0, Number(n) - 1) }, (_, k) => BigInt(k + 1));

/** All rugs, walking 1..next_rug_id-1. */
export async function listRugs(): Promise<Rug[]> {
  return pool(range(await nextRugId()), 6, getRug);
}

/** All loans, walking 1..next_loan_id-1. */
export async function listLoans(): Promise<Loan[]> {
  return pool(range(await nextLoanId()), 6, getLoan);
}

export async function listStores(extra: string[] = []): Promise<Store[]> {
  const addresses = [...new Set([...KNOWN_STORES, ...extra])];
  const found = await pool(addresses, 6, findStore);
  return found.filter((s): s is Store => s !== null);
}
