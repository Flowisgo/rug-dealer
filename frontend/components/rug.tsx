// The woven ends of a rug card: an end band of filled stepped diamonds in the rug's dye
// with abrash and a weft texture, and knotted fringe. Plain markup and inline
// SVG, no measuring: the server renders it, so it is there in the first paint.
// CSS grids with auto-fill keep only whole motifs and bundles, evenly spaced.
import type { ReactNode } from "react";
import {
  BUNDLES_PER_CELL,
  FRINGE_CELLS,
  FRINGE_H,
  MOTIF_H,
  MOTIF_W,
  bundleShape,
  guardBackground,
  motifLayers,
  tintColour,
  weave,
  type BundleSpec,
  type GuardBlock,
  type MotifSpec,
  type Paint,
  type Weave,
} from "@/lib/motifs";

const paintColour = (p: Paint, m: MotifSpec) => (p === "body" ? tintColour(m.tint) : `var(--${p})`);

function Motif({ spec }: { spec: MotifSpec }) {
  return (
    <span className="rug-motif">
      <svg width={MOTIF_W} height={MOTIF_H} viewBox={`0 0 ${MOTIF_W} ${MOTIF_H}`} focusable="false">
        {motifLayers(spec).map((l, i) => (
          <path key={i} d={l.d} style={{ fill: paintColour(l.paint, spec) }} />
        ))}
      </svg>
    </span>
  );
}

const Guard = ({ blocks }: { blocks: GuardBlock[] }) => <div className="rug-guard" style={{ background: guardBackground(blocks) }} />;

function EndBand({ w, at }: { w: Weave; at: "top" | "bottom" }) {
  // Each end has its own outer guard; the inner guards are the other end's.
  const [outer, inner] = at === "top" ? [w.guards.top, w.guards.bottom] : [w.guards.bottom, w.guards.top];
  return (
    <div className={`rug-band rug-band-${at}`} aria-hidden="true">
      <Guard blocks={at === "top" ? outer : inner} />
      <div className="rug-motifs">
        {w.motifs.map((m, i) => (
          <Motif key={i} spec={m} />
        ))}
      </div>
      <Guard blocks={at === "top" ? inner : outer} />
    </div>
  );
}

function Bundle({ b, x }: { b: BundleSpec; x: string }) {
  const s = bundleShape(b);
  return (
    <svg x={x} y={0} overflow="visible">
      {s.threads.map((d, i) => (
        <path key={i} d={d} />
      ))}
      <ellipse cx={0} cy={s.knot.cy} rx={s.knot.rx} ry={s.knot.ry} />
    </svg>
  );
}

function Fringe({ bundles, at }: { bundles: BundleSpec[]; at: "top" | "bottom" }) {
  const cells = Array.from({ length: FRINGE_CELLS }, (_, c) => bundles.slice(c * BUNDLES_PER_CELL, (c + 1) * BUNDLES_PER_CELL));
  return (
    <div className={`rug-fringe rug-fringe-${at}`} aria-hidden="true">
      {cells.map((cell, c) => (
        <svg key={c} width="100%" height={FRINGE_H} focusable="false">
          {cell.map((b, i) => (
            <Bundle key={i} b={b} x={`${((i + 0.5) * 100) / BUNDLES_PER_CELL}%`} />
          ))}
        </svg>
      ))}
    </div>
  );
}

/** The cloth of a rug card: fringe and end bands on the short ends, a plain
 * field between them. `seed` is the rug number, so each rug is a little
 * different and always the same; `head` holds the sewn-on label, name and
 * status. */
export function RugCloth({ seed, head, children }: { seed: number; head: ReactNode; children?: ReactNode }) {
  const w = weave(seed);
  return (
    <>
      <Fringe bundles={w.fringe.top} at="top" />
      <div className="rug-cloth">
        <EndBand w={w} at="top" />
        <div className="rug-field">
          {head}
          {children}
        </div>
        <EndBand w={w} at="bottom" />
      </div>
      <Fringe bundles={w.fringe.bottom} at="bottom" />
    </>
  );
}
