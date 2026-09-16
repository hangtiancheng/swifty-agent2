import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { EASE_DECEL } from "~/lib/motion";
import type { Citation } from "~/lib/types";

export interface CiteTarget {
  c: Citation;
  rect: DOMRect;
}

/** Citation popover: clicking a [n] marker shows its section_path + source text.
    Positioned below the marker and pulled back inside if it overflows the viewport's
    right/bottom edge; closes on outside click / Esc / scroll / resize. */
export function CitePopover({
  target,
  onClose,
}: {
  target: CiteTarget | null;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  // Render first, then measure and position (height depends on content); a layout side
  // effect is standard practice for this kind of popover
  useLayoutEffect(() => {
    if (!target) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- position is set only after measuring the DOM
      setPos(null);
      return;
    }
    const r = target.rect;
    const pw = Math.min(320, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left, window.innerWidth - pw - 12));
    let top = r.bottom + 6;
    const ph = popRef.current?.offsetHeight ?? 220;
    if (top + ph > window.innerHeight - 12) {
      top = Math.max(12, r.top - ph - 6);
    }
    setPos({ left, top, width: pw });
  }, [target]);

  useEffect(() => {
    if (!target) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (e.target instanceof Node && popRef.current?.contains(e.target)) {
        return;
      }
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [target, onClose]);

  if (!target) {
    return null;
  }
  const c = target.c;
  return (
    <motion.div
      ref={popRef}
      initial={{ opacity: 0, scale: 0.96, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE_DECEL }}
      className="scroll-slim border-outline-variant bg-card text-body-small text-on-surface shadow-e4 fixed z-50 max-h-[50vh] overflow-y-auto rounded-lg border p-4 leading-relaxed"
      style={
        pos
          ? { left: pos.left, top: pos.top, width: pos.width }
          : { left: 0, top: 0, visibility: "hidden" }
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="bg-primary-container text-on-primary-container rounded-full px-2.5 py-0.5 text-[11px] font-medium">
          {"Source [" + String(c.n) + "]"}
        </span>
        {c.content_type ? (
          <span className="text-on-surface-variant text-label-small">
            {c.content_type}
          </span>
        ) : null}
      </div>
      <div className="text-label-medium text-primary break-words">
        {c.section_path ?? "Source"}
      </div>
      {c.question ? (
        <div className="text-on-surface mt-2 font-medium">{c.question}</div>
      ) : null}
      <div className="text-on-surface-variant mt-1.5 wrap-break-word whitespace-pre-wrap">
        {c.answer ?? ""}
      </div>
    </motion.div>
  );
}
