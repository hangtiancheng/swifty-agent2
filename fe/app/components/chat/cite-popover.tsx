import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
    <div
      ref={popRef}
      className="scroll-cat border-ink bg-paper shadow-hard fixed z-50 max-h-[50vh] overflow-y-auto border-3 p-3 text-[13px] leading-relaxed"
      style={
        pos
          ? { left: pos.left, top: pos.top, width: pos.width }
          : { left: 0, top: 0, visibility: "hidden" }
      }
    >
      <div className="border-muted text-coral mb-1.5 border-b-2 border-dashed pb-1.5 text-xs font-bold break-words">
        {c.section_path ?? "Source"}
      </div>
      {c.question ? <div className="mb-1 font-bold">{c.question}</div> : null}
      <div className="wrap-break-word whitespace-pre-wrap">
        {c.answer ?? ""}
      </div>
      <div className="text-muted mt-2 text-[11px]">
        {"Source [" + String(c.n) + "]"}
        {c.content_type ? " · " + c.content_type : ""}
      </div>
    </div>
  );
}
