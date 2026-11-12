import { describe, expect, it } from "vitest";
import {
  BUNDLES_PER_CELL,
  FRINGE_CELLS,
  FRINGE_H,
  MOTIF_COUNT,
  MOTIF_H,
  MOTIF_W,
  bundleShape,
  guardBackground,
  motifLayers,
  weave,
  type MotifSpec,
} from "../lib/motifs";

/** Rects of a path made only of `M x y h w v h h -w z` rows. */
const rects = (d: string) =>
  [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)h(-?[\d.]+)v(-?[\d.]+)h-?[\d.]+z/g)].map(([, x, y, w, h]) => ({ x: +x, y: +y, w: +w, h: +h }));

describe("seeding by rug number", () => {
  it("the same number always gives the same rug", () => {
    for (const n of [0, 1, 7, 42, 1500]) expect(weave(n)).toEqual(weave(n));
  });

  it("different numbers give different rugs", () => {
    const seen = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => JSON.stringify(weave(n))));
    expect(seen.size).toBe(12);
    // Neighbours differ in the band itself, not only in the fringe.
    for (let n = 1; n < 12; n++) {
      const a = weave(n), b = weave(n + 1);
      expect(JSON.stringify([a.motifs, a.guards])).not.toBe(JSON.stringify([b.motifs, b.guards]));
    }
  });

  it("varies within a rug: one taller motif, at most one saffron centre, some abrash", () => {
    let withAbrash = 0;
    for (let n = 1; n <= 50; n++) {
      const { motifs } = weave(n);
      expect(motifs).toHaveLength(MOTIF_COUNT);
      expect(motifs.filter((m) => m.tall)).toHaveLength(1);
      expect(motifs.findIndex((m) => m.tall)).toBeLessThan(3); // visible on a phone too
      expect(motifs.filter((m) => m.centre === "saffron").length).toBeLessThanOrEqual(1);
      if (new Set(motifs.map((m) => m.tint)).size > 1) withAbrash++;
    }
    expect(withAbrash).toBeGreaterThan(40);
  });
});

describe("stepped diamond", () => {
  const spec: MotifSpec = { tall: false, tint: 0, centre: "wool", centreSize: 1 };

  it("fits its box, with steps wider than they are tall", () => {
    for (const m of [spec, { ...spec, tall: true }, { ...spec, centreSize: 0 as const }]) {
      for (const layer of motifLayers(m)) {
        for (const r of rects(layer.d)) {
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w).toBeLessThanOrEqual(MOTIF_W);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.y + r.h).toBeLessThanOrEqual(MOTIF_H);
        }
      }
      const body = rects(motifLayers(m)[0].d);
      for (let i = 1; i < body.length; i++) {
        const step = Math.abs(body[i].w - body[i - 1].w) / 2;
        if (step) expect(step).toBeGreaterThan(body[i].h);
      }
    }
  });

  it("is filled with the dye, with a contrasting centre inside it", () => {
    const [body, centre] = motifLayers(spec);
    expect(body.paint).toBe("body");
    expect(centre.paint).toBe("wool");
    const area = (d: string) => rects(d).reduce((s, r) => s + r.w * r.h, 0);
    expect(area(centre.d)).toBeLessThan(area(body.d) / 3);
  });

  it("the taller motif is one step taller", () => {
    const h = (m: typeof spec) => rects(motifLayers(m)[0].d).length;
    expect(h({ ...spec, tall: true })).toBe(h(spec) + 1);
  });
});

describe("fringe and guards", () => {
  it("has a bundle for every slot, each 3 or 4 threads of 14 to 18px", () => {
    const { fringe } = weave(9);
    for (const end of [fringe.top, fringe.bottom]) {
      expect(end).toHaveLength(FRINGE_CELLS * BUNDLES_PER_CELL);
      for (const b of end) {
        expect([3, 4]).toContain(b.threads.length);
        for (const t of b.threads) {
          expect(t.len).toBeGreaterThanOrEqual(14);
          expect(t.len).toBeLessThanOrEqual(18);
        }
      }
    }
  });

  it("threads stay inside the fringe strip", () => {
    for (const b of weave(3).fringe.bottom) {
      for (const d of bundleShape(b).threads) {
        const ys = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => +m[2]);
        for (const y of ys) expect(y).toBeLessThanOrEqual(FRINGE_H);
      }
    }
  });

  it("guard abrash is hard-edged blocks of the dye's tints", () => {
    const css = guardBackground(weave(5).guards.top);
    expect(css).toMatch(/^linear-gradient\(90deg, /);
    expect(css).not.toMatch(/#[0-9a-f]|rgba?\(|hsla?\(/i); // palette variables only
    // Every block has a start and an end, so neighbours meet with hard edges.
    expect(css.match(/[\d.]+% [\d.]+%/g)).toHaveLength(weave(5).guards.top.length);
  });
});
