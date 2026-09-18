import "~/components/admin-nav";
import "~/components/lottie";
import { cn } from "~/lib/cn";
import { enterOnce } from "~/lib/motion";

/* Shared presentational primitives (lit-jsx functional components — called on
   every render, no state of their own; Lit reactivity lives in the page
   elements that compose them). */

/* ---------- Buttons ---------- */

export type BtnVariant = "default" | "go" | "no" | "ok" | "tonal" | "text";
export type BtnSize = "md" | "sm";

const BTN_BASE =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap select-none " +
  "transition-[background-color,color,box-shadow,transform] duration-200 ease-standard active:scale-[0.97] " +
  "disabled:pointer-events-none disabled:opacity-38";
const BTN_SIZE: Record<BtnSize, string> = {
  md: "h-10 px-5 text-label-large",
  sm: "h-8 px-3.5 text-label-medium",
};
const BTN_VARIANT: Record<BtnVariant, string> = {
  default:
    "border border-outline text-primary hover:bg-primary/8 active:bg-primary/12",
  go: "bg-primary text-on-primary shadow-e1 hover:bg-primary-hover hover:shadow-e2 active:bg-primary-pressed",
  no: "bg-error text-on-error shadow-e1 hover:bg-error-hover hover:shadow-e2 active:bg-error-pressed",
  ok: "bg-success text-on-success shadow-e1 hover:bg-success-hover hover:shadow-e2",
  tonal:
    "bg-secondary-container text-on-secondary-container hover:bg-secondary-container-hover",
  text: "px-3.5 text-primary hover:bg-primary/8 active:bg-primary/12",
};

export interface BtnProps {
  variant?: BtnVariant;
  size?: BtnSize;
  class?: string;
  children?: unknown;
  disabled?: boolean;
  title?: string;
  onClick?: (e: MouseEvent) => void;
  [prop: string]: unknown;
}

export function Btn(props: BtnProps) {
  const {
    variant = "default",
    size = "md",
    class: cls,
    children,
    ...rest
  } = props;
  return (
    <button
      type="button"
      class={cn(BTN_BASE, BTN_SIZE[size], BTN_VARIANT[variant], cls)}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface BtnLinkProps {
  to: string;
  variant?: BtnVariant;
  size?: BtnSize;
  class?: string;
  children?: unknown;
}

/** Button-styled link (in-app navigation; the Router intercepts the click) */
export function BtnLink({
  to,
  variant = "default",
  size = "md",
  class: cls,
  children,
}: BtnLinkProps) {
  return (
    <a
      href={to}
      class={cn(
        BTN_BASE,
        BTN_SIZE[size],
        BTN_VARIANT[variant],
        "no-underline",
        cls,
      )}
    >
      {children}
    </a>
  );
}

/* ---------- Status pills ---------- */

export type PillTone =
  | "pass"
  | "fail"
  | "missing"
  | "running"
  | "info"
  | "sev-strict"
  | "sev-medium"
  | "sev-lenient"
  | "plain";

const PILL_TONE: Record<PillTone, string> = {
  pass: "bg-success-container text-on-success-container",
  fail: "bg-error-container text-on-error-container",
  missing: "bg-surface-container-high text-on-surface-variant",
  running: "bg-primary-container text-on-primary-container",
  info: "bg-secondary-container text-on-secondary-container",
  "sev-strict": "bg-error-container text-on-error-container",
  "sev-medium": "bg-warning-container text-on-warning-container",
  "sev-lenient": "bg-surface-container-high text-on-surface-variant",
  plain: "bg-surface-container-high text-on-surface-variant",
};

export interface PillProps {
  tone?: PillTone;
  class?: string;
  children?: unknown;
}

export function Pill({ tone = "plain", class: cls, children }: PillProps) {
  return (
    <span
      class={cn(
        "text-label-small inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 whitespace-nowrap",
        PILL_TONE[tone],
        cls,
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Panel / top bar / page shell ---------- */

export interface PanelProps {
  title?: unknown;
  pill?: unknown;
  lede?: unknown;
  tight?: boolean;
  class?: string;
  children?: unknown;
}

export function Panel({
  title,
  pill,
  lede,
  tight,
  class: cls,
  children,
}: PanelProps) {
  return (
    <section
      ref={(el: Element | undefined) => {
        enterOnce(el, { y: 14 });
      }}
      class={cn(
        "bg-card shadow-e1 mt-4 rounded-lg p-4 sm:px-5 sm:py-4.5",
        tight && "pb-4",
        cls,
      )}
    >
      {title ? (
        <h2 class="text-title-small text-on-surface flex flex-wrap items-center gap-2.5">
          {title}
          {pill}
        </h2>
      ) : null}
      {lede ? (
        <p class="text-body-small text-on-surface-variant mt-1 mb-3 leading-relaxed">
          {lede}
        </p>
      ) : null}
      {children}
    </section>
  );
}

export interface TopBarProps {
  title: unknown;
  sub?: unknown;
  children?: unknown;
}

export function TopBar({ title, sub, children }: TopBarProps) {
  return (
    <div class="bg-card shadow-e1 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-4 py-4 sm:px-5">
      <h1 class="text-title-large text-on-surface sm:text-headline-small font-medium tracking-normal sm:font-medium">
        {title}
      </h1>
      {sub ? (
        <span class="text-body-small text-on-surface-variant">{sub}</span>
      ) : null}
      <span class="flex-1" />
      {children}
    </div>
  );
}

export interface PageShellProps {
  title: unknown;
  sub?: unknown;
  active: string;
  actions?: unknown;
  maxW?: string;
  children?: unknown;
}

/** Shared shell for admin pages: top bar + nav + content (with entrance animation).
    Content spans the full viewport width; pass maxW to constrain and center it. */
export function PageShell({
  title,
  sub,
  active,
  actions,
  maxW,
  children,
}: PageShellProps) {
  return (
    <div
      class={cn(
        "w-full px-3 pt-5 pb-16 sm:px-5 lg:px-8",
        maxW && cn("mx-auto", maxW),
      )}
    >
      <TopBar title={title} sub={sub}>
        {actions}
      </TopBar>
      <admin-nav active={active}></admin-nav>
      {children}
    </div>
  );
}

/* ---------- Gate-bar stats ---------- */

export interface StatProps {
  label: unknown;
  value: unknown;
  tone?: "pass" | "fail";
  small?: boolean;
}

export function Stat({ label, value, tone, small }: StatProps) {
  return (
    <div class="bg-card shadow-e1 min-w-28 rounded-lg px-4 py-2.5">
      <span class="text-label-medium text-on-surface-variant block">
        {label}
      </span>
      <b
        class={cn(
          "text-headline-small mt-0.5 block leading-8 font-medium tabular-nums",
          small && "text-title-medium leading-7",
          tone === "pass" && "text-success",
          tone === "fail" && "text-error",
        )}
      >
        {value}
      </b>
    </div>
  );
}

export function GateBar({ children }: { children?: unknown }) {
  return <div class="mt-4 flex flex-wrap items-stretch gap-3">{children}</div>;
}

/* ---------- Tips / placeholders ---------- */

export interface TipProps {
  children?: unknown;
  class?: string;
}

export function Tip({ children, class: cls }: TipProps) {
  return (
    <div
      class={cn(
        "bg-secondary-container text-on-secondary-container text-body-small mt-3 rounded-lg px-4 py-3 leading-relaxed [&_b]:font-semibold",
        cls,
      )}
    >
      {children}
    </div>
  );
}

export interface MissingBoxProps {
  children?: unknown;
  class?: string;
}

/** Shared placeholder for a missing artifact: states what is missing and which target to run */
export function MissingBox({ children, class: cls }: MissingBoxProps) {
  return (
    <div
      class={cn(
        "border-outline-variant text-on-surface-variant text-body-small rounded-lg border border-dashed px-4 py-8 text-center",
        cls,
      )}
    >
      {children ??
        "Artifact not generated yet — run the corresponding make target first"}
    </div>
  );
}

/* ---------- Table primitives ---------- */

export function TableScroll({
  children,
  class: cls,
}: {
  children?: unknown;
  class?: string;
}) {
  return <div class={cn("scroll-slim overflow-x-auto", cls)}>{children}</div>;
}

export function Tbl({
  children,
  class: cls,
}: {
  children?: unknown;
  class?: string;
}) {
  return (
    <table
      class={cn(
        "text-body-small w-full border-collapse [&_tbody_tr:last-child_td]:border-b-0",
        cls,
      )}
    >
      {children}
    </table>
  );
}

export function Th({
  children,
  class: cls,
}: {
  children?: unknown;
  class?: string;
}) {
  return (
    <th
      class={cn(
        "border-outline-variant text-on-surface-variant text-label-medium border-b px-3 py-2.5 text-left whitespace-nowrap",
        cls,
      )}
    >
      {children}
    </th>
  );
}

export interface TdProps {
  children?: unknown;
  class?: string;
  num?: boolean;
  colSpan?: number;
}

export function Td({ children, class: cls, num, colSpan }: TdProps) {
  return (
    <td
      colSpan={colSpan}
      class={cn(
        "border-outline-variant text-on-surface border-b px-3 py-2.5 text-left align-middle",
        num && "num",
        cls,
      )}
    >
      {children}
    </td>
  );
}

export interface TrProps {
  children?: unknown;
  bad?: boolean;
  class?: string;
}

export function Tr({ children, bad, class: cls }: TrProps) {
  return (
    <tr
      class={cn(
        "hover:bg-on-surface/4 transition-colors duration-150",
        bad && "bg-error-container/50 hover:bg-error-container/70",
        cls,
      )}
    >
      {children}
    </tr>
  );
}

/* ---------- Numeric cell: 3 decimals + bar ---------- */

export interface ScoreCellProps {
  v?: number | null;
  redLine?: number | null;
}

/** Scores in 0–1 (like F1) are drawn this way so highs and lows are easy to scan.
 *  hi/lo coloring only applies when a red line is given — with no line there should
 *  be no implied pass/fail. */
export function ScoreCell({ v, redLine }: ScoreCellProps) {
  const width = Math.max(3, Math.round((v ?? 0) * 100));
  const hasLine = redLine !== null && redLine !== undefined;
  const tone = !hasLine
    ? "bg-primary"
    : (v ?? 0) >= redLine
      ? "bg-success"
      : "bg-error";
  return (
    <Td num>
      <div class="flex items-center justify-end gap-2">
        <span class="tabular-nums">
          {v === null || v === undefined ? "—" : v.toFixed(3)}
        </span>
        <span class="bg-surface-container-highest h-1.5 w-14 shrink-0 overflow-hidden rounded-full">
          <span
            class={cn(
              "ease-decel block h-full rounded-full transition-[width] duration-500",
              tone,
            )}
            style={{ width: `${width}%` }}
          />
        </span>
      </div>
    </Td>
  );
}

/* ---------- Small boxed value ---------- */

export function KvBox({ label, value }: { label: unknown; value: unknown }) {
  return (
    <div class="bg-surface-container-high text-on-surface-variant text-label-small min-w-[88px] rounded-md px-3 py-2">
      <b class="text-title-medium text-on-surface block font-medium tabular-nums">
        {value}
      </b>
      {label}
    </div>
  );
}

export function KvRow({ children }: { children?: unknown }) {
  return <div class="mt-3 flex flex-wrap gap-2">{children}</div>;
}

/* ---------- Section heading ---------- */

export interface SectionHeadProps {
  children?: unknown;
  unit?: string;
  class?: string;
}

export function SectionHead({ children, unit, class: cls }: SectionHeadProps) {
  return (
    <div class={cn("text-title-small text-on-surface mt-5 mb-1.5", cls)}>
      {children}
      {unit ? (
        <span class="text-on-surface-variant text-label-small ml-1.5 font-normal">
          {unit}
        </span>
      ) : null}
    </div>
  );
}

/* ---------- Page-level loading placeholder ---------- */

export function PageLoading({ label }: { label?: string }) {
  return (
    <div class="flex flex-col items-center justify-center gap-2 py-14">
      <lottie-anim
        src="/lottie/yarn.lottie"
        loop
        autoplay
        class="h-16 w-16"
      ></lottie-anim>
      <p class="text-body-small text-on-surface-variant">
        {label ?? "Loading…"}
      </p>
    </div>
  );
}
