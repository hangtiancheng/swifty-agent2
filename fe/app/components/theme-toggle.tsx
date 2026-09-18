import { customElement, createRef, state } from "@swifty.js/lit-jsx";
import { animate } from "motion";


import { cn } from "~/lib/cn";
import { Icon } from "~/lib/icons";
import { LightElement } from "~/lib/light-element";
import { EASE_STANDARD } from "~/lib/motion";
import { currentTheme, subscribeTheme, toggleTheme, type Theme } from "~/lib/theme";

@customElement("theme-toggle")
export class ThemeToggle extends LightElement {
  @state() private theme: Theme = "light";
  private iconRef = createRef<HTMLSpanElement>();
  private unsub?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.theme = currentTheme();
    this.unsub = subscribeTheme(() => {
      this.theme = currentTheme();
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub?.();
  }

  protected override updated(changed: Map<string | number | symbol, unknown>): void {
    if (changed.has("theme") && changed.get("theme") !== undefined) {
      // Swap-in: the new icon rotates/scales into place (the old one is gone
      // with the re-render — same feel as the AnimatePresence mode="wait" original)
      const el = this.iconRef.value;
      if (el) {
        animate(el, { rotate: [-60, 0], opacity: [0, 1], scale: [0.7, 1] }, { duration: 0.22, ease: EASE_STANDARD });
      }
    }
  }

  protected override render() {
    const dark = this.theme === "dark";
    const label = dark ? "Switch to light mode" : "Switch to dark mode";
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={label}
        title={label}
        class={cn(
          "text-on-surface-variant hover:bg-on-surface/8 active:bg-on-surface/12 grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-200",
        )}
      >
        <span ref={this.iconRef} class="grid place-items-center">
          <Icon name={dark ? "moon" : "sun"} class="h-5 w-5" />
        </span>
      </button>
    );
  }
}
