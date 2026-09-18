import { customElement, state } from "@swifty.js/lit-jsx";

import { cn } from "~/lib/cn";
import { Icon } from "~/lib/icons";
import { LightElement } from "~/lib/light-element";
import { fxEnter, fxOut } from "~/lib/motion";

/* Global toast: bottom-center, stacks up to three, auto-dismisses after 3.6s.
   The React version lived in a context provider; here it is a module-level
   service (toast()) plus one <toast-host> element mounted once in main.ts. */

export type ToastKind = "info" | "error";

export interface ToastItem {
  id: number;
  msg: string;
  kind: ToastKind;
}

export type ToastFn = (msg: string, isErr?: boolean) => void;

type ToastListener = (event: ToastEvent) => void;
type ToastEvent = { type: "push"; item: ToastItem } | { type: "dismiss"; id: number };

const listeners = new Set<ToastListener>();
let nextId = 1;

function emit(event: ToastEvent): void {
  for (const l of listeners) {
    l(event);
  }
}

/** Show a toast; isErr styles it as an error. Replaces the useToast() context. */
export const toast: ToastFn = (msg, isErr) => {
  const id = nextId++;
  emit({ type: "push", item: { id, msg, kind: isErr ? "error" : "info" } });
  window.setTimeout(() => {
    emit({ type: "dismiss", id });
  }, 3600);
};

@customElement("toast-host")
export class ToastHost extends LightElement {
  @state() private items: ToastItem[] = [];
  private els = new Map<number, HTMLElement>();
  private animated = new Set<number>();
  private unsub?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    const listener: ToastListener = (event) => {
      if (event.type === "push") {
        this.items = [...this.items.slice(-2), event.item];
      } else {
        void this.dismiss(event.id);
      }
    };
    listeners.add(listener);
    this.unsub = () => {
      listeners.delete(listener);
    };
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub?.();
  }

  private async dismiss(id: number): Promise<void> {
    if (!this.items.some((t) => t.id === id)) {
      return;
    }
    const el = this.els.get(id);
    if (el) {
      await fxOut(el, { y: 10, scale: 0.95, duration: 0.24 });
    }
    this.items = this.items.filter((t) => t.id !== id);
    this.els.delete(id);
    this.animated.delete(id);
  }

  protected override render() {
    return (
      <div class="pointer-events-none fixed inset-x-0 bottom-7 z-[99] flex flex-col items-center gap-2 px-4">
        {this.items.map((t) => (
          <div
            ref={(el: Element | undefined) => {
              // Inline ref callbacks are re-invoked on every render (lit ref
              // directive); the animated-set keeps the entrance one-shot.
              if (el instanceof HTMLElement) {
                this.els.set(t.id, el);
                if (!this.animated.has(t.id)) {
                  this.animated.add(t.id);
                  fxEnter(el, { y: 28, scale: 0.92, duration: 0.3 });
                }
              }
            }}
            class={cn(
              "text-label-large shadow-e3 pointer-events-auto flex max-w-[84vw] items-center gap-2.5 rounded-md px-4 py-3",
              t.kind === "error"
                ? "bg-error-container text-on-error-container"
                : "bg-inverse-surface text-inverse-on-surface",
            )}
          >
            <Icon name={t.kind === "error" ? "circle-alert" : "circle-check"} class="h-4.5 w-4.5 shrink-0" />
            {t.msg}
          </div>
        ))}
      </div>
    );
  }
}
