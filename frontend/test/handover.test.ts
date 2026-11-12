import { describe, expect, it } from "vitest";
import type { Rug } from "../lib/contract";
import { decodeNative, findRedeem, type AppEvent } from "../lib/events";
import { CONTRACT_ID } from "../lib/deployment";
import { checkHandover, forgetHandedOver, handoverKey, type Handover } from "../lib/handover";

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
