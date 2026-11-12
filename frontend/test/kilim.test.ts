import { describe, expect, it } from "vitest";
import { COLS, FRINGE_FULL, FRINGE_SHORT, ROWS, kilim, type Dye } from "../lib/kilim";

const dyes = (n: number) => kilim(n, "medallion").rows.map((row) => row.flatMap((r) => Array<Dye>(r.w).fill(r.dye)));

describe("a rug woven from its number", () => {
  it("is the same rug every time for the same number", () => {
    expect(kilim(5, "medallion")).toEqual(kilim(5, "medallion"));
    expect(kilim(5, "banded")).toEqual(kilim(5, "banded"));
  });

  it("differs between numbers", () => {
    const seen = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((n) => JSON.stringify(kilim(n, "medallion").rows)));
    expect(seen.size).toBe(8);
  });

  it("fills every row with whole cells, edge to edge", () => {
    for (const family of ["medallion", "banded"] as const) {
      const k = kilim(9, family);
      expect(k.rows).toHaveLength(ROWS);
      for (const row of k.rows) {
        let x = 0;
        for (const run of row) {
          expect(run.x).toBe(x);
          expect(run.w).toBeGreaterThan(0);
          x += run.w;
        }
        expect(x).toBe(COLS);
      }
    }
  });

  it("has mirrored end panels, as a kilim does", () => {
    const g = dyes(11);
    for (let y = 0; y < 4; y++) {
      expect(g[y]).toEqual([...g[y]].reverse());
      expect(g[ROWS - 1 - y]).toEqual(g[y]);
    }
  });

  it("keeps saffron to small highlights", () => {
    for (let n = 1; n <= 20; n++) {
      const cells = dyes(n).flat();
      expect(cells.filter((d) => d === "saffron").length / cells.length).toBeLessThan(0.06);
    }
  });
});

describe("fringe", () => {
  it("ties the warp ends in groups of three at both ends", () => {
    const k = kilim(3, "medallion", FRINGE_FULL);
    for (const end of [k.fringe.top, k.fringe.bottom]) {
      expect(end).toHaveLength((COLS * 2) / 3);
      for (const b of end) expect(b.threads).toHaveLength(3);
    }
  });

  it("hangs no further than about its length", () => {
    for (const len of [FRINGE_FULL, FRINGE_SHORT]) {
      for (const b of kilim(4, "banded", len).fringe.bottom) {
        for (const d of b.threads) {
          const y = Number(d.trim().split(/[ QL]/).pop());
          expect(y).toBeLessThanOrEqual(len * 1.2);
          expect(y).toBeGreaterThan(1);
        }
      }
    }
  });

  it("can be left off, and never changes the rug itself", () => {
    const none = kilim(6, "medallion", 0);
    expect(none.fringe.top).toEqual([]);
    expect(none.fringe.bottom).toEqual([]);
    expect(kilim(6, "medallion", FRINGE_SHORT).rows).toEqual(none.rows);
    expect(kilim(6, "medallion", FRINGE_FULL).outline).toEqual(none.outline);
  });
});
