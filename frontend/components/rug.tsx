"use client";
// The woven ends of a rug card: an end band of stepped diamonds in the rug's
// dye, and knotted fringe. Inline SVG from whole-pixel squares (crispEdges),
// sized to the card, so every repeat is whole.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { BAND_HEIGHT, DIAMONDS, FRINGE_HEIGHT, GAP, GUARD, fringePath, motifPath } from "@/lib/motifs";

/** Width of an element in whole CSS pixels, kept up to date. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** End band: outer guard, the diamonds, inner guard. */
function EndBand({ at }: { at: "top" | "bottom" }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const d = useMemo(() => {
    const guards = `M0 0h${width}v${GUARD}h${-width}zM0 ${BAND_HEIGHT - GUARD}h${width}v${GUARD}h${-width}z`;
    return guards + motifPath(DIAMONDS, width, GUARD + GAP).d;
  }, [width]);
  return (
    <div ref={ref} className={`rug-band rug-band-${at}`} aria-hidden="true">
      {width > 0 && (
        <svg width={width} height={BAND_HEIGHT} viewBox={`0 0 ${width} ${BAND_HEIGHT}`} shapeRendering="crispEdges" focusable="false">
          <rect width={width} height={BAND_HEIGHT} style={{ fill: "var(--wool)" }} />
          <path d={d} fill="currentColor" />
        </svg>
      )}
    </div>
  );
}

/** Knotted fringe on one short end. */
function Fringe({ at }: { at: "top" | "bottom" }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const d = useMemo(() => fringePath(width, at), [width, at]);
  return (
    <div ref={ref} className={`rug-fringe rug-fringe-${at}`} aria-hidden="true">
      {width > 0 && (
        <svg width={width} height={FRINGE_HEIGHT} viewBox={`0 0 ${width} ${FRINGE_HEIGHT}`} shapeRendering="crispEdges" focusable="false">
          <path d={d} fill="currentColor" />
        </svg>
      )}
    </div>
  );
}

/** The cloth of a rug card: fringe and end bands on the short ends, a plain
 * field between them. `head` holds the sewn-on label, name and status. */
export function RugCloth({ head, children }: { head: ReactNode; children?: ReactNode }) {
  return (
    <>
      <Fringe at="top" />
      <div className="rug-cloth">
        <EndBand at="top" />
        <div className="rug-field">
          {head}
          {children}
        </div>
        <EndBand at="bottom" />
      </div>
      <Fringe at="bottom" />
    </>
  );
}
