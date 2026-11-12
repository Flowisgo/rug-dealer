import { describe, expect, it } from "vitest";
import { CELL, DIAMONDS, FRINGE_HEIGHT, fringePath, motifPath } from "../lib/motifs";

/** Rects of a path made only of `M x y h w v h h -w z` squares. */
const rects = (d: string) =>
  [...d.matchAll(/M(-?\d+) (-?\d+)h(-?\d+)v(-?\d+)h-?\d+z/g)].map(([, x, y, w, h]) => ({ x: +x, y: +y, w: +w, h: +h }));

describe("end band of stepped diamonds", () => {
  it("uses only whole pixels", () => {
    for (const width of [339, 343, 470, 1046]) {
      for (const r of rects(motifPath(DIAMONDS, width, 3).d)) {
        for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it("draws whole diamonds, centred, starting and ending on a diamond", () => {
    for (const width of [339, 343, 470, 1046]) {
      const { d, left, used } = motifPath(DIAMONDS, width, 3);
      const all = rects(d);
      const minX = Math.min(...all.map((r) => r.x));
      const maxX = Math.max(...all.map((r) => r.x + r.w));
      expect(minX).toBe(left);
      expect(maxX).toBe(left + used);
      expect(minX).toBeGreaterThanOrEqual(0);
      expect(maxX).toBeLessThanOrEqual(width);
      // Margins differ by at most one square.
      expect(Math.abs(left - (width - maxX))).toBeLessThanOrEqual(CELL);
      // The run is n tiles plus one more diamond.
      expect((used / CELL - DIAMONDS.cap) % DIAMONDS.tile[0].length).toBe(0);
      // Mirror image: the band reads the same from either corner.
      const mirrored = all.map((r) => `${left + used - (r.x - left) - r.w},${r.y},${r.w}`).sort();
      expect(mirrored).toEqual(all.map((r) => `${r.x},${r.y},${r.w}`).sort());
    }
  });

  it("draws nothing when the band is narrower than one diamond", () => expect(motifPath(DIAMONDS, 10, 3).d).toBe(""));
});

describe("knotted fringe", () => {
  it("stays inside its strip and is the same every time", () => {
    for (const at of ["top", "bottom"] as const) {
      const d = fringePath(343, at);
      expect(d).toBe(fringePath(343, at));
      for (const r of rects(d)) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(343);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.y + r.h).toBeLessThanOrEqual(FRINGE_HEIGHT);
      }
    }
  });

  it("puts the knots against the rug: top fringe hangs up, bottom fringe hangs down", () => {
    const knots = (at: "top" | "bottom") => rects(fringePath(343, at)).filter((r) => r.w > 1);
    for (const k of knots("bottom")) expect(k.y).toBeLessThan(FRINGE_HEIGHT / 2);
    for (const k of knots("top")) expect(k.y).toBeGreaterThan(FRINGE_HEIGHT / 2 - 2);
  });

  it("varies thread lengths", () => {
    const lengths = new Set(rects(fringePath(343, "bottom")).filter((r) => r.w === 1 && r.y > 3).map((r) => r.h));
    expect(lengths.size).toBeGreaterThan(2);
  });
});
