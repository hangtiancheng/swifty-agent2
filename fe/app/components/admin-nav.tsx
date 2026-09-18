import { createRef, customElement, property } from "@swifty.js/lit-jsx";
import { animate } from "motion";

import "~/components/theme-toggle";
import { cn } from "~/lib/cn";
import { Icon } from "~/lib/icons";
import { LightElement } from "~/lib/light-element";
import { enterOnce, springTransition } from "~/lib/motion";

/* Admin navigation shell: a single nav bar shared by every admin page (from the
   original admin.js). Entries keep each module's own path; the nav only gathers
   them in one place and does not rewrite any routes.
   The active pill springs between links; the previous position is cached at
   module level so the pill visibly slides across page-to-page remounts (the
   motion layoutId behaviour of the React original). */

interface NavModule {
  href: string;
  label: string;
  children?: [string, string][];
}

const NAV: NavModule[] = [
  { href: "/admin", label: "Admin Console" },
  { href: "/kb", label: "Knowledge Base" },
  { href: "/rag-eval", label: "RAG Eval" },
  { href: "/review", label: "Review Queue" },
  { href: "/observability", label: "Observability" },
  { href: "/topics", label: "Topics" },
  {
    href: "/acceptance",
    label: "Acceptance",
    children: [
      ["/acceptance", "Overview"],
      ["/acceptance/eval", "Eval"],
      ["/acceptance/data", "Data"],
      ["/acceptance/errors", "Errors"],
    ],
  },
];

/** Which module the current page belongs to: exact match first, then by prefix
    (/acceptance/eval falls under /acceptance). */
function moduleOf(active: string): NavModule | undefined {
  return (
    NAV.find((m) => m.href === active) ??
    NAV.find((m) => m.href !== "/" && active.startsWith(m.href + "/"))
  );
}

let lastMainHref: string | null = null;
let lastSubHref: string | null = null;

@customElement("admin-nav")
export class AdminNav extends LightElement {
  @property() active = "";

  private barRef = createRef<HTMLDivElement>();
  private subRef = createRef<HTMLDivElement>();
  private pillRef = createRef<HTMLSpanElement>();
  private subLineRef = createRef<HTMLSpanElement>();
  private ro?: ResizeObserver;

  override connectedCallback(): void {
    super.connectedCallback();
    enterOnce(this, { y: -8, duration: 0.35 });
    // Re-seat the indicators when layout shifts (font load, resize)
    this.ro = new ResizeObserver(() => {
      this.moveIndicators(true);
    });
    this.ro.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.ro?.disconnect();
  }

  protected override updated(): void {
    this.moveIndicators(false);
  }

  private moveIndicators(instant: boolean): void {
    const pill = this.pillRef.value;
    const bar = this.barRef.value;
    if (pill && bar) {
      const link = bar.querySelector<HTMLAnchorElement>(
        'a[aria-current="page"]',
      );
      if (link) {
        const href = link.getAttribute("href") ?? "";
        const from =
          !instant && lastMainHref && lastMainHref !== href
            ? bar.querySelector<HTMLAnchorElement>(
                `a[href="${CSS.escape(lastMainHref)}"]`,
              )
            : null;
        if (from && from !== link) {
          animate(
            pill,
            {
              x: [from.offsetLeft, link.offsetLeft],
              width: [from.offsetWidth, link.offsetWidth],
            },
            springTransition,
          );
        } else {
          pill.style.transform = `translateX(${String(link.offsetLeft)}px)`;
          pill.style.width = `${String(link.offsetWidth)}px`;
        }
        lastMainHref = href;
      }
    }

    const line = this.subLineRef.value;
    const sub = this.subRef.value;
    if (line && sub) {
      const link = sub.querySelector<HTMLAnchorElement>(
        'a[aria-current="page"]',
      );
      if (link) {
        const href = link.getAttribute("href") ?? "";
        const from =
          !instant && lastSubHref && lastSubHref !== href
            ? sub.querySelector<HTMLAnchorElement>(
                `a[href="${CSS.escape(lastSubHref)}"]`,
              )
            : null;
        const xOf = (el: HTMLAnchorElement) => el.offsetLeft + 14; // inset-x-3.5
        const wOf = (el: HTMLAnchorElement) => el.offsetWidth - 28;
        const y = link.offsetTop + link.offsetHeight - 2;
        line.style.top = `${String(y)}px`;
        if (from && from !== link) {
          animate(
            line,
            { x: [xOf(from), xOf(link)], width: [wOf(from), wOf(link)] },
            springTransition,
          );
        } else {
          line.style.transform = `translateX(${String(xOf(link))}px)`;
          line.style.width = `${String(wOf(link))}px)`;
        }
        lastSubHref = href;
      }
    }
  }

  protected override render() {
    const path = this.active || location.pathname;
    const mod = moduleOf(path);
    return (
      <nav class="mt-4" aria-label="Admin navigation">
        <div
          ref={this.barRef}
          class="scroll-slim bg-card shadow-e1 relative flex items-center gap-1 overflow-x-auto rounded-lg p-1.5"
        >
          <span
            ref={this.pillRef}
            class="bg-secondary-container absolute inset-y-1.5 left-0 rounded-full"
            aria-hidden="true"
          />
          <span class="bg-primary-container text-on-primary-container text-label-large relative z-10 mx-1 flex shrink-0 items-center gap-1.5 rounded-full py-1.5 pr-3.5 pl-2">
            <Icon name="cat" class="h-4.5 w-4.5" />
            Admin
          </span>
          {NAV.map((m) => {
            const on = m === mod;
            return (
              <a
                href={m.href}
                class={cn(
                  "text-label-large relative z-10 flex shrink-0 items-center rounded-full px-4 py-2 whitespace-nowrap no-underline transition-colors duration-200",
                  on
                    ? "text-on-secondary-container"
                    : "text-on-surface-variant hover:bg-on-surface/8 hover:text-on-surface",
                )}
                aria-current={on ? "page" : undefined}
              >
                {m.label}
              </a>
            );
          })}
          <span class="flex-1" />
          <a
            href="/"
            class="text-label-large text-primary hover:bg-primary/8 relative z-10 flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 whitespace-nowrap no-underline transition-colors duration-200"
          >
            <Icon name="message-square" class="h-4.5 w-4.5" />
            Chat
          </a>
          <theme-toggle className="relative z-10 mr-1 ml-0.5 shrink-0"></theme-toggle>
        </div>
        {mod?.children ? (
          <div
            ref={this.subRef}
            class="scroll-slim relative mt-2 flex gap-1 overflow-x-auto px-1"
          >
            <span
              ref={this.subLineRef}
              class="bg-primary absolute left-0 h-0.75 rounded-full"
              aria-hidden="true"
            />
            {mod.children.map(([href, label]) => {
              const on = href === path;
              return (
                <a
                  href={href}
                  class={cn(
                    "text-label-medium relative shrink-0 rounded-full px-3.5 py-1.5 whitespace-nowrap no-underline transition-colors duration-200",
                    on
                      ? "text-primary"
                      : "text-on-surface-variant hover:bg-on-surface/8 hover:text-on-surface",
                  )}
                  aria-current={on ? "page" : undefined}
                >
                  {label}
                </a>
              );
            })}
          </div>
        ) : null}
      </nav>
    );
  }
}
