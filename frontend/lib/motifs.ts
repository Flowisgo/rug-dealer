// Rug-card weaving maths: motifs on a grid of 2px squares, laid out as whole
// repeats centred in a band, and knotted fringe. Pure, so it can be tested.

/** One motif on a grid of 2px squares, 7 rows tall. `tile` repeats; `cap` is
 * the number of leading tile columns drawn once more at the end, so the run
 * starts and ends on the same whole shape. */
export type Motif = { name: string; tile: string[]; cap: number };

/** Stepped diamonds with an open eye, a dot between each pair. The run ends
 * on a whole diamond at both corners. */
export const DIAMONDS: Motif = {
  name: "Stepped diamonds",
  tile: [
    "...#......",
    "..###.....",
    ".##.##....",
    "##.#.##.#.",
    ".##.##....",
    "..###.....",
    "...#......",
  ],
  cap: 7,
};


export const CELL = 2; // px per square
export const GUARD = 2; // guard stripe
export const GAP = 1; // wool between guard and motif
export const ROWS = 7;
export const BAND_HEIGHT = 2 * (GUARD + GAP) + ROWS * CELL; // 20px
export const FRINGE_HEIGHT = 14;

/** Path for whole tiles centred in `width`, plus the closing cap. One path,
 * horizontal runs of squares merged. */
export function motifPath(m: Motif, width: number, top: number): { d: string; left: number; used: number } {
  const tileW = m.tile[0].length;
  const cols = Math.floor(width / CELL);
  const n = Math.floor((cols - m.cap) / tileW);
  if (n < 1) return { d: "", left: 0, used: 0 };
  const total = n * tileW + m.cap;
  const left = Math.floor((cols - total) / 2) * CELL + Math.floor((width % CELL) / 2);
  let d = "";
  for (let r = 0; r < ROWS; r++) {
    const row = m.tile[r];
    let start = -1;
    for (let c = 0; c <= total; c++) {
      const on = c < total && row[c % tileW] === "#";
      if (on && start < 0) start = c;
      if (!on && start >= 0) {
        d += `M${left + start * CELL} ${top + r * CELL}h${(c - start) * CELL}v${CELL}h${-(c - start) * CELL}z`;
        start = -1;
      }
    }
  }
  return { d, left, used: total * CELL };
}


/** Small deterministic noise, 0..1, so the fringe varies but never changes. */
const jitter = (i: number, salt: number) => (((i + 1) * 9301 + salt * 49297) % 233280) / 233280;

export const FRINGE = { pitch: 12, bundle: 5, threads: 3, warp: 3, knot: 2, inset: 3 } as const;

/** Fringe: warp threads leave the rug, are gathered in a knot, then hang
 * loose for 5 to 9px, each bundle a little different. Centred in `width`. */
export function fringePath(width: number, at: "top" | "bottom"): string {
  const { pitch, bundle, threads, warp, knot, inset } = FRINGE;
  const n = Math.floor((width - 2 * inset - bundle) / pitch) + 1;
  if (n < 1) return "";
  const left = Math.floor((width - ((n - 1) * pitch + bundle)) / 2);
  // Draw for the bottom end (y grows away from the rug), flip for the top.
  const rect = (x: number, y: number, w: number, h: number) =>
    `M${x} ${at === "bottom" ? y : FRINGE_HEIGHT - y - h}h${w}v${h}h${-w}z`;
  let d = "";
  for (let i = 0; i < n; i++) {
    const x = left + i * pitch;
    const knotAt = warp + (jitter(i, 3) < 0.3 ? 1 : 0); // some knots sit a pixel lower
    for (let t = 0; t < threads; t++) d += rect(x + t * 2, 0, 1, knotAt);
    d += rect(x, knotAt, bundle, knot);
    const free = FRINGE_HEIGHT - knotAt - knot;
    for (let t = 0; t < threads; t++) {
      const len = Math.max(4, free - Math.floor(jitter(i * threads + t, 2) * 5)); // 5..9 mostly
      d += rect(x + t * 2, knotAt + knot, 1, len);
    }
  }
  return d;
}
