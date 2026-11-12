// A woven rug drawn from its number: weft cells merged into runs, a faint weft
// texture, uneven selvedges, and warp ends tied into fringe at both ends.
// Rendered on the server; nothing is measured. With `weave`, the rug weaves
// itself on first load, row by row from the bottom, over its bare warp.
import { useId, useMemo } from "react";
import {
  CELL_H,
  CELL_W,
  COLS,
  FRINGE_FULL,
  FRINGE_SHORT,
  RUG_H,
  RUG_W,
  dyeColour,
  kilim,
  type Bundle,
  type Family,
} from "@/lib/kilim";

function Fringe({ bundles, at }: { bundles: Bundle[]; at: "top" | "bottom" }) {
  return (
    <g className="kilim-fringe" transform={at === "top" ? "scale(1,-1)" : `translate(0 ${RUG_H})`}>
      {bundles.map((b, i) => (
        <g key={i}>
          {b.threads.map((d, j) => (
            <path key={`u${j}`} className="under" d={d} strokeWidth={0.95} />
          ))}
          {b.threads.map((d, j) => (
            <path key={`w${j}`} className="warp" d={d} strokeWidth={0.55} />
          ))}
          <rect className="knot" x={b.knot.x} y={b.knot.y} width={b.knot.w} height={b.knot.h} rx={0.8} />
        </g>
      ))}
    </g>
  );
}

export type FringeSize = "full" | "short" | "none";

export function Kilim({
  seed,
  family = "medallion",
  fringe = "full",
  weave = false,
  className,
}: {
  seed: number;
  family?: Family;
  fringe?: FringeSize;
  /** Weave in on first load (the landing page's one motion). */
  weave?: boolean;
  className?: string;
}) {
  const len = fringe === "full" ? FRINGE_FULL : fringe === "short" ? FRINGE_SHORT : 0;
  const k = useMemo(() => kilim(seed, family, len), [seed, family, len]);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const pad = len ? len + 1 : 1;
  return (
    <svg
      className={className ? `kilim ${className}` : "kilim"}
      viewBox={`-1 ${-pad} ${RUG_W + 2} ${RUG_H + 2 * pad}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={`c${id}`}>
          <path d={k.outline} />
        </clipPath>
        {/* Weft: one darker and one lighter pass per cell row, low contrast. */}
        <pattern id={`w${id}`} width={CELL_W} height={CELL_H / 2} patternUnits="userSpaceOnUse">
          <rect width={CELL_W} height={0.32} className="kilim-weft-dark" />
          <rect y={0.75} width={CELL_W} height={0.28} className="kilim-weft-light" />
        </pattern>
      </defs>
      {len > 0 && <Fringe bundles={k.fringe.top} at="top" />}
      {len > 0 && <Fringe bundles={k.fringe.bottom} at="bottom" />}
      <g clipPath={`url(#c${id})`}>
        {k.rows.map((row, y) =>
          row.map((run) => (
            <rect
              key={`${y}-${run.x}`}
              x={run.x * CELL_W}
              y={y * CELL_H}
              width={run.w * CELL_W + 0.06}
              height={CELL_H + 0.06}
              style={{ fill: dyeColour(run.dye, run.tint) }}
            />
          )),
        )}
        <rect width={RUG_W} height={RUG_H} fill={`url(#w${id})`} />
      </g>
      {weave && (
        <g className="loom-shed">
          <rect className="loom-cover" width={RUG_W} height={RUG_H} />
          {Array.from({ length: COLS * 2 }, (_, i) => (
            <line key={i} className="loom-warp" x1={(i + 0.5) * (RUG_W / (COLS * 2))} x2={(i + 0.5) * (RUG_W / (COLS * 2))} y1={0} y2={RUG_H} />
          ))}
        </g>
      )}
    </svg>
  );
}
