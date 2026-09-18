import { createRef, nothing, property, state } from "@swifty.js/lit-jsx";
import { animate } from "motion";

import { cn } from "~/lib/cn";
import { LightElement } from "~/lib/light-element";
import { EASE_ACCEL, EASE_DECEL, fxEnter, fxOut } from "~/lib/motion";

/** Shared modal chrome: scrim + centered card with enter/exit animation, Esc to
    close, backdrop click to close. Subclasses provide dialogTitle/dialogSub/
    dialogBody; the card stays mounted while `visible` lags `open` so the exit
    animation can play (the AnimatePresence pattern from the React original). */
export abstract class ModalShell extends LightElement {
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) onClose?: () => void;

  @state() protected visible = false;
  protected backdropRef = createRef<HTMLDivElement>();
  protected cardRef = createRef<HTMLDivElement>();
  private keyHandler = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.onClose?.();
    }
  };

  protected override updated(changed: Map<string | number | symbol, unknown>): void {
    if (!changed.has("open")) {
      return;
    }
    if (this.open) {
      this.visible = true;
      void this.updateComplete.then(() => {
        const backdrop = this.backdropRef.value;
        const card = this.cardRef.value;
        if (backdrop) {
          fxEnter(backdrop, { duration: 0.2 });
        }
        if (card) {
          animate(card, { opacity: [0, 1], scale: [0.92, 1], y: [20, 0] }, { duration: 0.3, ease: EASE_DECEL });
        }
      });
      document.addEventListener("keydown", this.keyHandler);
    } else if (this.visible) {
      document.removeEventListener("keydown", this.keyHandler);
      void this.close();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this.keyHandler);
  }

  private async close(): Promise<void> {
    const backdrop = this.backdropRef.value;
    const card = this.cardRef.value;
    const outs: Promise<void>[] = [];
    if (backdrop) {
      outs.push(fxOut(backdrop, { duration: 0.2 }));
    }
    if (card) {
      outs.push(
        animate(card, { opacity: [1, 0], scale: [1, 0.95], y: [0, 10] }, { duration: 0.2, ease: EASE_ACCEL }).then(
          () => undefined,
        ),
      );
    }
    await Promise.all(outs);
    this.visible = false;
  }

  protected abstract dialogTitle(): string;
  protected abstract dialogSub(): string;
  protected abstract dialogBody(): unknown;

  /** Max-width class for the dialog card; subclasses can widen it. */
  protected cardMaxW = "max-w-[440px]";

  protected override render() {
    if (!this.visible) {
      return nothing;
    }
    return (
      <div
        ref={this.backdropRef}
        class="bg-scrim/50 fixed inset-0 z-50 flex items-center justify-center p-5 backdrop-blur-[2px]"
        onClick={(e: MouseEvent) => {
          if (e.target === e.currentTarget) {
            this.onClose?.();
          }
        }}
      >
        <div
          ref={this.cardRef}
          role="dialog"
          aria-modal="true"
          aria-label={this.dialogTitle()}
          class={cn(
            "scroll-slim bg-surface-container-high shadow-e5 max-h-[90dvh] w-full overflow-y-auto rounded-xl p-6",
            this.cardMaxW,
          )}
        >
          <h3 class="text-headline-small text-on-surface font-medium">{this.dialogTitle()}</h3>
          <p class="text-body-medium text-on-surface-variant mt-2 mb-5 leading-6">{this.dialogSub()}</p>
          {this.dialogBody()}
        </div>
      </div>
    );
  }
}
