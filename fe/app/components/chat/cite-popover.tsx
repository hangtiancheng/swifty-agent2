import {
  createRef,
  customElement,
  nothing,
  property,
  state,
} from "@swifty.js/lit-jsx";

import { LightElement } from "~/lib/light-element";
import { fxEnter } from "~/lib/motion";
import type { Citation } from "~/lib/types";

export interface CiteTarget {
  c: Citation;
  rect: DOMRect;
}

/** Citation popover: clicking a [n] marker shows its section_path + source text.
    Positioned below the marker and pulled back inside if it overflows the viewport's
    right/bottom edge; closes on outside click / Esc / scroll / resize. */
@customElement("cite-popover")
export class CitePopover extends LightElement {
  @property({ attribute: false }) target: CiteTarget | null = null;
  @property({ attribute: false }) onClose?: () => void;

  @state() private pos: { left: number; top: number; width: number } | null =
    null;
  private popRef = createRef<HTMLDivElement>();

  private onDoc = (e: MouseEvent): void => {
    const pop = this.popRef.value;
    if (e.target instanceof Node && pop?.contains(e.target)) {
      return;
    }
    this.onClose?.();
  };
  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.onClose?.();
    }
  };
  private onWin = (): void => {
    this.onClose?.();
  };

  protected override updated(
    changed: Map<string | number | symbol, unknown>,
  ): void {
    if (!changed.has("target")) {
      return;
    }
    if (!this.target) {
      this.pos = null;
      this.detach();
      return;
    }
    // Render first, then measure and position (height depends on content)
    void this.updateComplete.then(() => {
      this.measure();
      const pop = this.popRef.value;
      if (pop) {
        fxEnter(pop, { y: -6, scale: 0.96, duration: 0.2 });
      }
    });
    this.attach();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.detach();
  }

  private attach(): void {
    this.detach();
    document.addEventListener("mousedown", this.onDoc);
    document.addEventListener("keydown", this.onKey);
    window.addEventListener("resize", this.onWin);
    window.addEventListener("scroll", this.onWin, true);
  }

  private detach(): void {
    document.removeEventListener("mousedown", this.onDoc);
    document.removeEventListener("keydown", this.onKey);
    window.removeEventListener("resize", this.onWin);
    window.removeEventListener("scroll", this.onWin, true);
  }

  private measure(): void {
    if (!this.target) {
      return;
    }
    const r = this.target.rect;
    const pw = Math.min(320, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left, window.innerWidth - pw - 12));
    let top = r.bottom + 6;
    const ph = this.popRef.value?.offsetHeight ?? 220;
    if (top + ph > window.innerHeight - 12) {
      top = Math.max(12, r.top - ph - 6);
    }
    this.pos = { left, top, width: pw };
  }

  protected override render() {
    if (!this.target) {
      return nothing;
    }
    const c = this.target.c;
    const pos = this.pos;
    return (
      <div
        ref={this.popRef}
        class="scroll-slim border-outline-variant bg-card text-body-small text-on-surface shadow-e4 fixed z-50 max-h-[50vh] overflow-y-auto rounded-lg border p-4 leading-relaxed"
        style={
          pos
            ? {
                left: `${String(pos.left)}px`,
                top: `${String(pos.top)}px`,
                width: `${String(pos.width)}px`,
              }
            : { left: "0", top: "0", visibility: "hidden" }
        }
      >
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <span class="bg-primary-container text-on-primary-container rounded-full px-2.5 py-0.5 text-[11px] font-medium">
            {"Source [" + String(c.n) + "]"}
          </span>
          {c.content_type ? (
            <span class="text-on-surface-variant text-label-small">
              {c.content_type}
            </span>
          ) : null}
        </div>
        <div class="text-label-medium text-primary wrap-break-word">
          {c.section_path ?? "Source"}
        </div>
        {c.question ? (
          <div class="text-on-surface mt-2 font-medium">{c.question}</div>
        ) : null}
        <div class="text-on-surface-variant mt-1.5 wrap-break-word whitespace-pre-wrap">
          {c.answer ?? ""}
        </div>
      </div>
    );
  }
}
