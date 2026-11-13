import { describe, expect, it } from "vitest";
import type { Rug } from "../lib/contract";
import { decodeNative, findRedeem, type AppEvent } from "../lib/events";
import { CONTRACT_ID } from "../lib/deployment";
import { Address, xdr } from "@stellar/stellar-sdk";
import { checkHandover, decodeHandover, encodeHandover, forgetHandedOver, handoverKey, isExpired, type Handover } from "../lib/handover";
import { pendingOutcome, runExclusive } from "../lib/tx";

const STORE = "GSTORE";
const WEAVER = "GWEAVER";
const rug = (over: Partial<Rug> = {}): Rug => ({ id: 4n, store: STORE, description: "d", price: 1n, owner: WEAVER, status: "Free", ...over });
const code: Handover = { v: 1, rug: "4", holder: WEAVER, store: STORE, auth: [], until: 1, contract: CONTRACT_ID };

describe("what the store sees for a hand-over code", () => {
  it("ready while the holder still holds a free rug", () => expect(checkHandover(code, rug())).toBe("ready"));
  it("refuses a code signed for an earlier deployment, even if the rug number exists", () => {
    expect(checkHandover({ ...code, contract: "COLDCONTRACT" }, rug())).toBe("old-contract");
    const { contract: _, ...legacy } = code;
    expect(checkHandover(legacy, rug())).toBe("old-contract");
  });
  it("keeps saved codes apart per contract", () => expect(handoverKey(4n)).toContain(CONTRACT_ID));
  it("handed over once the rug is Redeemed, so there is no sign button", () =>
    expect(checkHandover(code, rug({ status: "Redeemed" }))).toBe("handed-over"));
  it("unknown rug", () => expect(checkHandover(code, undefined)).toBe("unknown-rug"));
  it("wrong store", () => expect(checkHandover(code, rug({ store: "GOTHER" }))).toBe("wrong-store"));
  it("holder changed (e.g. the store bought the rug since)", () => expect(checkHandover(code, rug({ owner: STORE }))).toBe("not-holder"));
  it("wrong store wins over handed over", () => expect(checkHandover(code, rug({ store: "GOTHER", status: "Redeemed" }))).toBe("wrong-store"));
  it("never ready while the rug is pledged for a loan: the store must keep it", () => {
    expect(checkHandover(code, rug({ status: "Requested" }))).toBe("pledged");
    expect(checkHandover(code, rug({ status: "Locked" }))).toBe("pledged");
    expect(checkHandover(code, rug({ status: "Locked" }), 0)).toBe("pledged");
  });
  it("expired once the ledger passes the signature's last ledger", () => {
    const c = { ...code, until: 100 };
    expect(checkHandover(c, rug(), 100)).toBe("ready");
    expect(checkHandover(c, rug(), 101)).toBe("expired");
    expect(isExpired(c, 101)).toBe(true);
    expect(isExpired(c, 99)).toBe(false);
  });
});

describe("decoding a hand-over code", () => {
  const A = "GBH4TKU2HPW7PGY5BCDU73E3PMZUK7TQ7RVDHP5QDTK23BHKW2XDGOQF";
  const B = "GBWCNPACZXNZKJKB7NA2EHRCZTNWT3LQBEHTYPTVF5X6VZNU5RXPPLCN";
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: Address.fromString(CONTRACT_ID).toScAddress(), functionName: "redeem", args: [] }),
      ),
      subInvocations: [],
    }),
  }).toXDR("base64");
  const good: Handover = { v: 1, rug: "7", holder: A, store: B, auth: [entry], until: 5_700_000, contract: CONTRACT_ID };
  const enc = (h: unknown) => encodeHandover(h as Handover);

  it("round-trips a real code", () => expect(decodeHandover(encodeHandover(good))).toEqual(good));
  it.each([
    ["a rug number that isn't a number", { ...good, rug: "abc" }],
    ["rug number zero", { ...good, rug: "0" }],
    ["a holder that isn't an account", { ...good, holder: "GA" }],
    ["a store that isn't an account", { ...good, store: 42 }],
    ["no auth entries", { ...good, auth: [] }],
    ["an auth entry that isn't XDR", { ...good, auth: ["not xdr"] }],
    ["a non-integer expiry", { ...good, until: 1.5 }],
    ["the wrong version", { ...good, v: 2 }],
  ])("rejects %s with a plain error, never a crash", (_, bad) => {
    expect(() => decodeHandover(enc(bad))).toThrow(/isn't valid/);
  });
  it("rejects text that isn't a code at all", () => expect(() => decodeHandover("not a code")).toThrow(/isn't valid/));
});

describe("one action at a time in a tab", () => {
  it("refuses a second action while the first is still running", async () => {
    let release!: () => void;
    const first = runExclusive("Lend 600.00 USDC", () => new Promise<string>((r) => (release = () => r("done"))));
    await expect(runExclusive("Repay 600.00 USDC", async () => "never")).rejects.toThrow(/Finish "Lend 600.00 USDC" first/);
    release();
    await expect(first).resolves.toBe("done");
    await expect(runExclusive("Repay 600.00 USDC", async () => "ok")).resolves.toBe("ok");
  });
  it("frees the lock even when the action fails", async () => {
    await expect(runExclusive("a", async () => Promise.reject(new Error("declined")))).rejects.toThrow("declined");
    await expect(runExclusive("b", async () => "ok")).resolves.toBe("ok");
  });
});

describe("a pending transaction left by an earlier page load", () => {
  it("blocks new actions only while it may still land", () => {
    expect(pendingOutcome("NOT_FOUND", 30_000)).toEqual({ status: "NOT_FOUND", clear: false });
  });
  it("is cleared and reported once it landed or failed", () => {
    expect(pendingOutcome("SUCCESS", 1_000)).toEqual({ status: "SUCCESS", clear: true });
    expect(pendingOutcome("FAILED", 1_000)).toEqual({ status: "FAILED", clear: true });
  });
  it("is cleared as expired, not 'still waiting', once past its time limit", () => {
    expect(pendingOutcome("NOT_FOUND", 10 * 60_000)).toEqual({ status: "EXPIRED", clear: true });
  });
});

describe("clearing saved hand-over codes", () => {
  const fakeStorage = (keys: string[]) => {
    const m = new Map(keys.map((k) => [k, "code"]));
    return { m, s: { getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => void m.delete(k) } };
  };

  it("drops the code for a rug that has been handed over and keeps the others", () => {
    const { m, s } = fakeStorage([handoverKey(4n), handoverKey(5n), "unrelated"]);
    const cleared = forgetHandedOver([rug({ id: 4n, status: "Redeemed" }), rug({ id: 5n, status: "Free" })], s);
    expect(cleared).toEqual([4n]);
    expect([...m.keys()].sort()).toEqual([handoverKey(5n), "unrelated"].sort());
  });

  it("does nothing without storage or saved codes", () => {
    expect(forgetHandedOver([rug({ status: "Redeemed" })], null)).toEqual([]);
    expect(forgetHandedOver([rug({ status: "Redeemed" })], fakeStorage([]).s)).toEqual([]);
  });
});

describe("finding the hand-over event", () => {
  const meta = (n: number) => ({ id: `e${n}`, ledger: n, at: `2026-11-12T10:0${n}:00Z`, txHash: "ab".repeat(32) });
  const events: AppEvent[] = [
    decodeNative(["rug_minted", 4n], { store: STORE, weaver: WEAVER, description: "d", price: 1n }, meta(1)),
    decodeNative(["rug_redeemed", 3n], { store: STORE, holder: "GSOMEONE" }, meta(2)),
    decodeNative(["rug_redeemed", 4n], { store: STORE, holder: WEAVER }, meta(3)),
  ];
  it("returns the redeem event for that rug, with holder and date", () => {
    expect(findRedeem(4n, events)).toMatchObject({ kind: "rug_redeemed", holder: WEAVER, at: "2026-11-12T10:03:00Z" });
  });
  it("returns null when the RPC no longer keeps it", () => expect(findRedeem(9n, events)).toBeNull());
});
