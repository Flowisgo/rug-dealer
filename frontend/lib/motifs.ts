// Rug-card weaving: the end-band diamonds and fringe, as pure data so every rug
// can be drawn on the server and tested. Each rug is seeded by its number, so
// two rugs side by side differ a little and the same rug always looks the same.

/** Paint of a motif layer. "body" takes the motif's abrash tint of the dye. */
export type Paint = "body" | "wool" | "walnut" | "saffron";

export type MotifSpec = {
  /** One step taller than the others. */
  tall: boolean;
  /** Abrash: 0 = the dye, 1 = a touch darker, 2 = a touch lighter. */
  tint: 0 | 1 | 2;
  centre: "wool" | "walnut" | "saffron";
  /** 0 = small centre, 1 = a step larger. */
  centreSize: 0 | 1;
};

export type ThreadSpec = { x: number; len: number; lean: number; sway: number };
export type BundleSpec = { knot: number; threads: ThreadSpec[] };

/** A block of the guard stripe's abrash: tint from `from`% to the next block. */
export type GuardBlock = { from: number; tint: 0 | 1 | 2 };

export type Weave = {
  motifs: MotifSpec[];
  guards: { top: GuardBlock[]; bottom: GuardBlock[] };
  fringe: { top: BundleSpec[]; bottom: BundleSpec[] };
};

/** Motif box in px. The band is 26px: 2px guard, 22px field, 2px guard. */
export const MOTIF_W = 24;
export const MOTIF_H = 20;
export const BAND_H = 26;
/** Motif cells: as many whole motifs as fit, about one per 112px. */
export const MOTIF_CELL = 112;
export const MOTIF_COUNT = 12; // enough for a 1340px card
/** Fringe cells hold four bundles each. */
export const FRINGE_H = 22;
export const FRINGE_CELL = 56;
export const FRINGE_CELLS = 26; // enough for a 1450px card
export const BUNDLES_PER_CELL = 4;

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

/** Mix the rug number and a salt into a 32-bit seed. */
const seedOf = (n: number, salt: number) => Math.imul((n >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);

const round = (v: number, places = 2) => Math.round(v * 10 ** places) / 10 ** places;

/** Abrash: tints that drift slowly, holding for a few steps before moving to
 * a neighbouring tint. */
function abrash(r: () => number, n: number, hold: number): (0 | 1 | 2)[] {
  const out: (0 | 1 | 2)[] = [];
  let t: 0 | 1 | 2 = r() < 0.5 ? 0 : r() < 0.5 ? 1 : 2;
  for (let i = 0; i < n; i++) {
    if (i > 0 && r() < 1 / hold) t = t === 0 ? (r() < 0.5 ? 1 : 2) : 0;
    out.push(t);
  }
  return out;
}

function guard(r: () => number): GuardBlock[] {
  const tints = abrash(r, 4, 1.4);
  const cuts = [0, 15 + r() * 20, 40 + r() * 20, 70 + r() * 15].map((v) => round(v, 1));
  return cuts.map((from, i) => ({ from, tint: tints[i] }));
}

function bundle(r: () => number): BundleSpec {
  const count = r() < 0.6 ? 4 : 3;
  const lean = (r() - 0.5) * 2 * 3; // whole bundle leans -3..3 degrees
  const threads: ThreadSpec[] = [];
  for (let t = 0; t < count; t++) {
    threads.push({
      x: round((t - (count - 1) / 2) * 1.25),
      len: round(14 + r() * 4, 1), // 14..18px
      lean: round(lean + (r() - 0.5) * 1.5, 1),
      sway: round((r() - 0.5) * 1.6, 2),
    });
  }
  return { knot: round(1.7 + r() * 0.5), threads };
}

/** Everything that varies on one rug, from its number. */
export function weave(rugNumber: number): Weave {
  const r = rng(seedOf(rugNumber, 1));
  const tints = abrash(r, MOTIF_COUNT, 3.5);
  const centre = r() < 0.7 ? "wool" : "walnut";
  const centreSize = (r() < 0.5 ? 0 : 1) as 0 | 1;
  const tall = Math.floor(r() * 3); // within the first three, so phones see it too
  const odd = 1 + Math.floor(r() * (MOTIF_COUNT - 1)); // one motif with the other centre size
  const saffron = r() < 0.35 ? Math.floor(r() * 3) : -1; // now and then, one saffron centre
  const motifs = tints.map((tint, i) => ({
    tall: i === tall,
    tint,
    centre: i === saffron ? "saffron" : centre,
    centreSize: (i === odd ? 1 - centreSize : centreSize) as 0 | 1,
  })) satisfies MotifSpec[];
  const fr = rng(seedOf(rugNumber, 2));
  const n = FRINGE_CELLS * BUNDLES_PER_CELL;
  return {
    motifs,
    guards: { top: guard(r), bottom: guard(r) },
    fringe: { top: Array.from({ length: n }, () => bundle(fr)), bottom: Array.from({ length: n }, () => bundle(fr)) },
  };
}

/** Union of row rectangles: a stepped shape, centred on x = MOTIF_W / 2. */
function rows(halfWidths: number[], rowH: number, top: number): string {
  const cx = MOTIF_W / 2;
  return halfWidths
    .map((hw, i) => (hw > 0 ? `M${round(cx - hw)} ${round(top + i * rowH)}h${round(hw * 2)}v${rowH}h${round(-hw * 2)}z` : ""))
    .join("");
}

/** Pick the middle `k` rows' indices of an `n`-row shape. */
const middle = (n: number, k: number) => Array.from({ length: k }, (_, i) => Math.floor((n - k) / 2) + i);

/**
 * A filled stepped diamond with a small contrasting centre, back to front.
 * Steps are wider than they are tall, as a weft-faced weave builds a diagonal
 * from horizontal passes.
 */
export function motifLayers(m: MotifSpec): { d: string; paint: Paint }[] {
  const rowH = 2.5;
  const outer = m.tall ? [2, 5, 8, 11, 11, 8, 5, 2] : [2, 5, 8, 11, 8, 5, 2];
  const top = (MOTIF_H - outer.length * rowH) / 2;
  const idx = middle(outer.length, (m.centreSize ? 3 : 1) + (outer.length % 2 ? 0 : 1));
  const centre = outer.map((_, i) => {
    const p = idx.indexOf(i);
    if (p < 0) return 0;
    if (!m.centreSize) return 2.5;
    return p === 0 || p === idx.length - 1 ? 1.5 : 4.5;
  });
  return [
    { d: rows(outer, rowH, top), paint: "body" },
    { d: rows(centre, rowH, top), paint: m.centre },
  ];
}

/** One fringe bundle, knot at the rug edge (y = 0 side), threads hanging down.
 * Local coordinates, centred on x = 0. */
export function bundleShape(b: BundleSpec): { knot: { cy: number; rx: number; ry: number }; threads: string[] } {
  const knotY = 2.4;
  const start = knotY + b.knot * 0.6;
  const threads = b.threads.map((t) => {
    const lean = Math.tan((t.lean * Math.PI) / 180) * t.len;
    const endX = t.x * 1.5 + lean;
    const endY = Math.min(FRINGE_H - 1, start + t.len - 2);
    const cx = (t.x + endX) / 2 + t.sway;
    const cy = (start + endY) / 2;
    return `M${round(t.x)} ${round(start)}Q${round(cx)} ${round(cy)} ${round(endX)} ${round(endY)}`;
  });
  return { knot: { cy: knotY, rx: round(b.knot + 0.4), ry: b.knot }, threads };
}

/** CSS colour of an abrash tint of the rug's dye. */
export const tintColour = (t: 0 | 1 | 2) =>
  t === 0 ? "var(--dye)" : t === 1 ? "color-mix(in srgb, var(--dye) 86%, var(--walnut))" : "color-mix(in srgb, var(--dye) 82%, var(--wool))";

/** Hard-edged abrash blocks for a guard stripe. */
export const guardBackground = (blocks: GuardBlock[]) =>
  `linear-gradient(90deg, ${blocks
    .map((b, i) => `${tintColour(b.tint)} ${b.from}% ${i + 1 < blocks.length ? blocks[i + 1].from : 100}%`)
    .join(", ")})`;
