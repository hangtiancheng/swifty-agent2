import {
  createRef,
  customElement,
  nothing,
  property,
  state,
} from "@swifty.js/lit-jsx";
import { animate } from "motion";

import { cn } from "~/lib/cn";
import { Icon } from "~/lib/icons";
import { LightElement } from "~/lib/light-element";
import {
  EASE_ACCEL,
  enterOnce,
  fxEnter,
  fxOut,
  softSpring,
} from "~/lib/motion";
import type { ConversationItem } from "~/lib/types";

/* Conversation sidebar: fixed column on desktop, drawer on mobile.
   List item = #id + summarized badge + preview. */

function ConvList(opts: {
  items: ConversationItem[];
  current: number | null;
  busy: boolean;
  onSwitch: (id: number) => void;
}) {
  const { items, current, busy, onSwitch } = opts;
  if (!items.length) {
    return (
      <div class="text-on-surface-variant text-label-small px-2 py-6 text-center">
        No conversations yet. Send a message to get started!
      </div>
    );
  }
  return (
    <div class="flex flex-col gap-1">
      {items.map((it, i) => (
        <button
          type="button"
          disabled={busy}
          ref={(el: Element | undefined) => {
            enterOnce(el, {
              x: -10,
              duration: 0.3,
              delay: Math.min(i * 0.03, 0.3),
            });
          }}
          class={cn(
            "w-full cursor-pointer rounded-lg px-3 py-2.5 text-left transition-colors duration-200",
            current === it.id
              ? "bg-secondary-container hover:bg-secondary-container-hover"
              : "hover:bg-on-surface/8",
            busy && "cursor-not-allowed opacity-60",
          )}
          onClick={() => {
            onSwitch(it.id);
          }}
        >
          <div
            class={cn(
              "text-label-large flex items-center gap-2",
              current === it.id
                ? "text-on-secondary-container"
                : "text-on-surface",
            )}
          >
            <span class="tabular-nums">#{it.id}</span>
            {it.has_summary ? (
              <span class="bg-tertiary-container text-on-tertiary-container rounded-full px-2 py-px text-[10px] font-medium">
                Summarized
              </span>
            ) : null}
          </div>
          <div
            class={cn(
              "text-body-small mt-0.5 truncate",
              current === it.id
                ? "text-on-secondary-container/75"
                : "text-on-surface-variant",
            )}
          >
            {it.preview ?? ""}
          </div>
        </button>
      ))}
    </div>
  );
}

@customElement("conv-sidebar")
export class ConvSidebar extends LightElement {
  @property({ attribute: false }) items: ConversationItem[] = [];
  @property({ attribute: false }) current: number | null = null;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) onSwitch?: (id: number) => void;

  protected override render() {
    return (
      <aside class="border-outline-variant bg-surface-container-low flex h-full w-64 shrink-0 flex-col border-r">
        <div class="text-title-small text-on-surface flex items-center gap-2 px-4 pt-4 pb-3">
          History
        </div>
        <div class="scroll-slim flex-1 overflow-y-auto px-2 pb-2.5">
          {ConvList({
            items: this.items,
            current: this.current,
            busy: this.busy,
            onSwitch: (id) => {
              this.onSwitch?.(id);
            },
          })}
        </div>
      </aside>
    );
  }
}

@customElement("mobile-drawer")
export class MobileDrawer extends LightElement {
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) onClose?: () => void;
  @property({ attribute: false }) items: ConversationItem[] = [];
  @property({ attribute: false }) current: number | null = null;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) onSwitch?: (id: number) => void;
  @property({ attribute: false }) onNewChat?: () => void;

  /** DOM presence, lagging `open` so the exit animation can play */
  @state() private visible = false;
  private backdropRef = createRef<HTMLDivElement>();
  private panelRef = createRef<HTMLDivElement>();

  protected override updated(
    changed: Map<string | number | symbol, unknown>,
  ): void {
    if (!changed.has("open")) {
      return;
    }
    if (this.open) {
      this.visible = true;
      void this.updateComplete.then(() => {
        const backdrop = this.backdropRef.value;
        const panel = this.panelRef.value;
        if (backdrop) {
          fxEnter(backdrop, { duration: 0.2 });
        }
        if (panel) {
          animate(panel, { x: [-320, 0] }, softSpring);
        }
      });
    } else if (this.visible) {
      void this.close();
    }
  }

  private async close(): Promise<void> {
    const backdrop = this.backdropRef.value;
    const panel = this.panelRef.value;
    const outs: Promise<void>[] = [];
    if (backdrop) {
      outs.push(fxOut(backdrop, { duration: 0.2 }));
    }
    if (panel) {
      outs.push(
        animate(
          panel,
          { x: [0, -320] },
          { duration: 0.25, ease: EASE_ACCEL },
        ).then(() => undefined),
      );
    }
    await Promise.all(outs);
    this.visible = false;
  }

  protected override render() {
    if (!this.visible) {
      return nothing;
    }
    return (
      <div
        ref={this.backdropRef}
        class="bg-scrim/45 fixed inset-0 z-50 md:hidden"
        onClick={() => {
          this.onClose?.();
        }}
      >
        <div
          ref={this.panelRef}
          class="bg-surface-container-low shadow-e5 flex h-full w-75 flex-col rounded-r-xl"
          role="dialog"
          aria-label="Conversation history"
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
          }}
        >
          <div class="flex items-center justify-between px-4 pt-4 pb-3">
            <span class="text-title-small text-on-surface">History</span>
            <button
              type="button"
              onClick={() => {
                this.onClose?.();
              }}
              aria-label="Close conversation list"
              class="text-on-surface-variant hover:bg-on-surface/8 grid h-9 w-9 cursor-pointer place-items-center rounded-full transition-colors duration-200"
            >
              <Icon name="x" class="h-4.5 w-4.5" />
            </button>
          </div>
          <div class="scroll-slim flex-1 overflow-y-auto px-2 pb-2.5">
            {ConvList({
              items: this.items,
              current: this.current,
              busy: this.busy,
              onSwitch: (id) => {
                this.onSwitch?.(id);
                this.onClose?.();
              },
            })}
          </div>
          <div class="p-3">
            <button
              type="button"
              class="border-outline text-primary hover:bg-primary/8 text-label-large flex h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border transition-all duration-200 active:scale-[0.98]"
              onClick={() => {
                this.onNewChat?.();
                this.onClose?.();
              }}
            >
              <Icon name="plus" class="h-4.5 w-4.5" />
              New chat
            </button>
          </div>
        </div>
      </div>
    );
  }
}
