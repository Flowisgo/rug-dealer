// A small flat-woven rug (kilim), generated from the rug's number. Pure data,
// so the server renders it and tests can check it. The same number always
// weaves the same rug; different numbers give different rugs.
//
// The rug is a grid of weft cells, wider than tall (a weft-faced weave builds
// shapes from horizontal passes). Designs are mirrored left-right and
// top-bottom like real kilims, then made a little irregular: abrash (the dye
// drifting between batches, row by row) and the odd motif woven differently.

/** Shown wherever a rug is the main picture, so nobody takes it for the real rug. */
export const RUG_PATTERN_NOTE = "Pattern made from the certificate number, not a photo of the rug.";

export type Dye = "wool" | "madder" | "indigo" | "walnut" | "saffron";
export type Family = "medallion" | "banded";

/** Grid size in cells, and a cell's size in SVG units. */
export const COLS = 21;
export const ROWS = 42;
export const CELL_W = 4;
export const CELL_H = 3;
export const RUG_W = COLS * CELL_W; // 84
export const RUG_H = ROWS * CELL_H; // 126
/** Fringe lengths in SVG units, beyond each end. */
export const FRINGE_FULL = 9;
export const FRINGE_SHORT = 5;
/** Warps per cell, warps per tied group, and where the knot sits. */
const WARPS_PER_CELL = 2;
const GROUP = 3;
const KNOT_Y = 1.8;

/** A run of same-coloured cells in one row. Tint: 0 the dye, 1 lighter, 2 darker. */
export type Run = { x: number; w: number; dye: Dye; tint: 0 | 1 | 2 };
/** One tied group of warp ends: a small knot, and the threads through it. */
export type Bundle = { knot: { x: number; y: number; w: number; h: number }; threads: string[] };

export type Kilim = {
  rows: Run[][];
  /** Rug outline with slightly uneven long sides (selvedges). */
  outline: string;
  fringe: { top: Bundle[]; bottom: Bundle[] };
};

/** mulberry32: small, fast, deterministic. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (n: number, salt: number) => Math.imul((n >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
const r2 = (v: number) => Math.round(v * 100) / 100;

type Grid = Dye[][];
const blank = (): Grid => Array.from({ length: ROWS }, () => Array<Dye>(COLS).fill("wool"));
const CX = (COLS - 1) / 2; // 10

/** End panel (elem), 4 rows at each end: plain wool, a dye stripe, small dots, a dark line. */
function ends(g: Grid, field: Dye, accent: Dye) {
  for (let y = 0; y < ROWS; y++) {
    const dy = Math.min(y, ROWS - 1 - y);
    if (dy > 3) continue;
    for (let x = 0; x < COLS; x++) {
      g[y][x] = dy === 0 ? "wool" : dy === 1 ? field : dy === 2 ? (Math.abs(x - CX) % 4 === 0 ? accent : "wool") : "walnut";
    }
  }
}

/** Medallion kilim: dark guards, a border band of small stepped motifs, and
 * one to three stepped diamonds stacked in a dyed field. */
function medallion(r: () => number): Grid {
  const g = blank();
  const field: Dye = r() < 0.55 ? "madder" : "indigo";
  const accent: Dye = field === "madder" ? "indigo" : "madder";
  const ring: Dye = r() < 0.5 ? "walnut" : accent;
  const n = 1 + Math.floor(r() * 3);
  const core: Dye = r() < 0.6 ? "saffron" : "wool";
  const borderInk: Dye = r() < 0.7 ? accent : "walnut";
  ends(g, field, accent);

  // Guard, a two-cell stepped border, guard, then the field.
  const inner = ROWS - 8; // 34 rows between the end panels
  for (let y = 4; y < ROWS - 4; y++) {
    const yy = y - 4;
    for (let x = 0; x < COLS; x++) {
      const dx = Math.min(x, COLS - 1 - x);
      const b = Math.min(dx, yy, inner - 1 - yy);
      if (b === 0 || b === 3) g[y][x] = "walnut";
      else if (b <= 2) {
        // Along the band: rows on the long sides, columns across the ends.
        const along = dx === b ? Math.abs(yy - (inner - 1) / 2) : Math.abs(x - CX);
        const k = Math.round(along) % 4;
        g[y][x] = (k + b) % 4 < 2 ? borderInk : "wool";
      } else g[y][x] = field;
    }
  }

  // The field: columns 4..16, rows 8..33.
  const left = 4;
  const top = 8;
  const height = ROWS - 2 * top; // 26

  // Small stepped triangles in the field's corners.
  for (let y = top; y < top + height; y++) {
    const fy = Math.min(y - top, top + height - 1 - y);
    for (let x = left; x < COLS - left; x++) {
      const fx = Math.min(x - left, COLS - 1 - left - x);
      if (fx + fy <= 1) g[y][x] = accent;
    }
  }

  // Medallions: stepped diamonds in concentric rings.
  const slot = height / n;
  const hw = 5.6;
  for (let i = 0; i < n; i++) {
    const cy = top + slot * (i + 0.5) - 0.5;
    const hh = Math.max(2.8, slot / 2 - 1);
    for (let y = top; y < top + height; y++) {
      for (let x = left + 1; x < COLS - left - 1; x++) {
        const u = Math.abs(x - CX) / hw + Math.abs(y - cy) / hh;
        if (u > 1) continue;
        g[y][x] = u > 0.7 ? "wool" : u > 0.4 ? ring : core;
      }
    }
  }

  // One stretch of border woven in the other colour, as a weaver's change of yarn.
  const odd = 6 + Math.floor(r() * (inner - 12));
  const side = r() < 0.5 ? 1 : COLS - 2;
  for (let y = 4 + odd - 2; y <= 4 + odd + 2; y++) if (g[y][side] === borderInk) g[y][side] = borderInk === "walnut" ? accent : "walnut";
  return g;
}

/** Banded kilim: horizontal bands of stripes and small repeating motifs,
 * mirrored about the middle, with a wider motif band at the centre. */
function banded(r: () => number): Grid {
  const g = blank();
  const field: Dye = r() < 0.5 ? "madder" : "indigo";
  const accent: Dye = field === "madder" ? "indigo" : "madder";
  ends(g, field, accent);

  type Band = { h: number; paint: (x: number, row: number) => Dye };
  const stripe = (d: Dye): Band => ({ h: 1, paint: () => d });
  const plain = (d: Dye, h: number): Band => ({ h, paint: () => d });
  const diamonds = (ground: Dye, ink: Dye, h: 3 | 5, period: 4 | 6): Band => ({
    h,
    paint: (x, row) => {
      const mid = (h - 1) / 2;
      const off = ((Math.round(x - CX) % period) + period) % period;
      const k = off > period / 2 ? off - period : off;
      return Math.abs(k) / (period / 2 - 0.4) + Math.abs(row - mid) / (mid + 0.6) <= 1 ? ink : ground;
    },
  });
  const zigzag = (ground: Dye, ink: Dye): Band => ({
    h: 3,
    paint: (x, row) => ((Math.round(Math.abs(x - CX)) + row) % 4 === 0 ? ink : ground),
  });

  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const half = (ROWS - 8) / 2; // 17 rows from the end panel to the centre
  const centre = diamonds(r() < 0.5 ? field : "wool", r() < 0.5 ? "wool" : "walnut", 5, 6);
  const bands: Band[] = [];
  let used = 0;
  const room = half - Math.ceil(centre.h / 2);
  while (used < room) {
    const left = room - used;
    const options: Band[] = [stripe("walnut"), stripe(accent), plain(field, 2), plain("wool", 1)];
    if (left >= 3) options.push(diamonds("wool", accent, 3, 4), diamonds(field, "wool", 3, 4), zigzag("wool", field));
    // Saffron stays a small highlight: only now and then, and only in a narrow band.
    if (left >= 5) options.push(diamonds(accent, "wool", 5, 6));
    if (left >= 3 && r() < 0.2) options.push(diamonds(field, "saffron", 3, 4));
    let b = pick(options);
    if (b.h > left) b = plain(field, left);
    bands.push(b);
    used += b.h;
  }
  // Paint the top half and the upper half of the centre band, then mirror:
  // the centre band's middle row lands on the fold.
  let y = 4;
  for (const b of bands) {
    for (let row = 0; row < b.h; row++, y++) for (let x = 1; x < COLS - 1; x++) g[y][x] = b.paint(x, row);
  }
  for (let row = 0; row < Math.ceil(centre.h / 2); row++, y++) {
    for (let x = 1; x < COLS - 1; x++) g[y][x] = centre.paint(x, row);
  }
  for (let yy = ROWS / 2; yy < ROWS - 4; yy++) g[yy] = [...g[ROWS - 1 - yy]];
  // Selvedges: dark warps wrapped along both long sides.
  for (let yy = 4; yy < ROWS - 4; yy++) {
    g[yy][0] = "walnut";
    g[yy][COLS - 1] = "walnut";
  }
  return g;
}

/** Abrash: per row, the dyed yarn drifts between batches. Not mirrored. */
function abrash(r: () => number): (0 | 1 | 2)[] {
  const out: (0 | 1 | 2)[] = [];
  let t: 0 | 1 | 2 = 0;
  for (let y = 0; y < ROWS; y++) {
    if (y > 0 && r() < 0.16) t = t === 0 ? (r() < 0.6 ? 1 : 2) : 0;
    out.push(t);
  }
  return out;
}

function runs(g: Grid, tints: (0 | 1 | 2)[]): Run[][] {
  return g.map((row, y) => {
    const out: Run[] = [];
    for (let x = 0; x < COLS; x++) {
      const dye = row[x];
      const tint = dye === "madder" || dye === "indigo" ? tints[y] : 0;
      const last = out[out.length - 1];
      if (last && last.dye === dye && last.tint === tint) last.w++;
      else out.push({ x, w: 1, dye, tint });
    }
    return out;
  });
}

/** Selvedges are never quite straight: a slow, small wobble on each side. */
function outline(r: () => number): string {
  const pl = r() * 6;
  const pr = r() * 6;
  const left: string[] = [];
  const right: string[] = [];
  for (let y = 0; y <= ROWS; y++) {
    const jl = 0.35 + 0.3 * Math.sin(y * 0.45 + pl) + (r() - 0.5) * 0.12;
    const jr = 0.35 + 0.3 * Math.sin(y * 0.4 + pr) + (r() - 0.5) * 0.12;
    left.push(`${r2(jl)} ${y * CELL_H}`);
    right.push(`${r2(RUG_W - jr)} ${y * CELL_H}`);
  }
  return `M${left.join("L")}L${right.reverse().join("L")}Z`;
}

/**
 * Fringe: the warp threads running on past the last weft row. Two warps per
 * cell, tied in groups of three with a small knot just past the rug's edge;
 * below the knot they hang loose, fanning a little, at slightly uneven
 * lengths. Drawn for the bottom end (y grows away from the rug); the top end
 * uses its own threads, flipped. `len` is the fringe length in SVG units.
 */
function fringe(r: () => number, len: number): Bundle[] {
  const warps = COLS * WARPS_PER_CELL;
  const pitch = RUG_W / warps;
  const out: Bundle[] = [];
  for (let g = 0; g < warps / GROUP; g++) {
    const xs = Array.from({ length: GROUP }, (_, i) => (g * GROUP + i + 0.5) * pitch);
    const kx = (xs[0] + xs[GROUP - 1]) / 2 + (r() - 0.5) * 0.5;
    const lean = (r() - 0.5) * 1.4;
    const threads = xs.map((x) => {
      const spread = x - kx;
      const atKnot = kx + spread * 0.22;
      const end = kx + spread * (0.5 + r() * 0.25) + lean;
      const y1 = KNOT_Y + Math.max(1.2, len - KNOT_Y + (r() - 0.5) * len * 0.28);
      const sway = (r() - 0.5) * 0.9;
      return `M${r2(x)} 0L${r2(atKnot)} ${KNOT_Y}Q${r2((atKnot + end) / 2 + sway)} ${r2((KNOT_Y + y1) / 2)} ${r2(end)} ${r2(y1)}`;
    });
    out.push({ knot: { x: r2(kx - 1.35), y: KNOT_Y - 0.7, w: 2.7, h: 1.4 }, threads });
  }
  return out;
}

/** Weave the rug for this number. `fringeLength` 0 leaves the warp ends off. */
export function kilim(rugNumber: number, family: Family, fringeLength: number = FRINGE_FULL): Kilim {
  const r = rng(seedOf(rugNumber, family === "medallion" ? 11 : 23));
  const g = family === "medallion" ? medallion(r) : banded(r);
  const rows = runs(g, abrash(r));
  const edge = outline(r);
  // The fringe has its own stream, so its length doesn't change the rug.
  const fr = rng(seedOf(rugNumber, 37));
  const top = fringeLength > 0 ? fringe(fr, fringeLength) : [];
  const bottom = fringeLength > 0 ? fringe(fr, fringeLength) : [];
  return { rows, outline: edge, fringe: { top, bottom } };
}

/** CSS colour for a dye and its abrash tint. */
export function dyeColour(dye: Dye, tint: 0 | 1 | 2): string {
  const base = `var(--${dye})`;
  if (tint === 1) return `color-mix(in srgb, ${base} 86%, var(--wool))`;
  if (tint === 2) return `color-mix(in srgb, ${base} 88%, var(--walnut))`;
  return base;
}
