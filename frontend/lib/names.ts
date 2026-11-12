// How people and businesses are named on screen. Demo accounts get their
// friendly name; anyone else is a short address, and a store says so.
import { DEMO_NAMES } from "./deployment";

export type PartyRole = "store";

export const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

/** "Kaya Rug House", "Store GAF3…6HYP", or "GAF3…6HYP". */
export function partyName(address: string, role?: PartyRole): string {
  const known = DEMO_NAMES[address];
  if (known) return known.name;
  return role === "store" ? `Store ${short(address)}` : short(address);
}
