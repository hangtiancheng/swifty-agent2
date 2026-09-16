import { motion } from "motion/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";

import { AdminNav } from "./admin-nav";

import { cn } from "~/lib/cn";
import { enterTransition } from "~/lib/motion";

/* ---------- Buttons ---------- */

type BtnVariant = "default" | "go" | "no" | "ok" | "tonal" | "text";
type BtnSize = "md" | "sm";

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

export function Btn({
  variant = "default",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: BtnSize;
}) {
  return (
    <button
      type="button"
      className={cn(BTN_BASE, BTN_SIZE[size], BTN_VARIANT[variant], className)}
      {...rest}
    />
  );
}

/** Button-styled link (in-app navigation) */
export function BtnLink({
  to,
  variant = "default",
  size = "md",
  className,
  children,
}: {
  to: string;
  variant?: BtnVariant;
  size?: BtnSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        BTN_BASE,
        BTN_SIZE[size],
        BTN_VARIANT[variant],
        "no-underline",
        className,
      )}
    >
      {children}
    </Link>
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

export function Pill({
  tone = "plain",
  className,
  children,
}: {
  tone?: PillTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "text-label-small inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 whitespace-nowrap",
        PILL_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Panel / top bar / page shell ---------- */

export function Panel({
  title,
  pill,
  lede,
  tight,
  className,
  children,
}: {
  title?: ReactNode;
  pill?: ReactNode;
  lede?: ReactNode;
  tight?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={enterTransition}
      className={cn(
        "bg-card shadow-e1 mt-4 rounded-lg p-4 sm:px-5 sm:py-4.5",
        tight && "pb-4",
        className,
      )}
    >
      {title ? (
        <h2 className="text-title-small text-on-surface flex flex-wrap items-center gap-2.5">
          {title}
          {pill}
        </h2>
      ) : null}
      {lede ? (
        <p className="text-body-small text-on-surface-variant mt-1 mb-3 leading-relaxed">
          {lede}
        </p>
      ) : null}
      {children}
    </motion.section>
  );
}

export function TopBar({
  title,
  sub,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="bg-card shadow-e1 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-4 py-4 sm:px-5">
      <h1 className="text-title-large text-on-surface sm:text-headline-small font-medium tracking-normal sm:font-medium">
        {title}
      </h1>
      {sub ? (
        <span className="text-body-small text-on-surface-variant">{sub}</span>
      ) : null}
      <span className="flex-1" />
      {children}
    </div>
  );
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
}: {
  title: ReactNode;
  sub?: ReactNode;
  active: string;
  actions?: ReactNode;
  maxW?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "w-full px-3 pt-5 pb-16 sm:px-5 lg:px-8",
        maxW && cn("mx-auto", maxW),
      )}
    >
      <TopBar title={title} sub={sub}>
        {actions}
      </TopBar>
      <AdminNav active={active} />
      {children}
    </div>
  );
}

/* ---------- Gate-bar stats ---------- */

export function Stat({
  label,
  value,
  tone,
  small,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: "pass" | "fail";
  small?: boolean;
}) {
  return (
    <div className="bg-card shadow-e1 min-w-[112px] rounded-lg px-4 py-2.5">
      <span className="text-label-medium text-on-surface-variant block">
        {label}
      </span>
      <b
        className={cn(
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

export function GateBar({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 flex flex-wrap items-stretch gap-3">{children}</div>
  );
}

/* ---------- Tips / placeholders ---------- */

export function Tip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-secondary-container text-on-secondary-container text-body-small mt-3 rounded-lg px-4 py-3 leading-relaxed [&_b]:font-semibold",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Shared placeholder for a missing artifact: states what is missing and which target to run */
export function MissingBox({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-outline-variant text-on-surface-variant text-body-small rounded-lg border border-dashed px-4 py-8 text-center",
        className,
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
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("scroll-slim overflow-x-auto", className)}>
      {children}
    </div>
  );
}

export function Tbl({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <table
      className={cn(
        "text-body-small w-full border-collapse [&_tbody_tr:last-child_td]:border-b-0",
        className,
      )}
    >
      {children}
    </table>
  );
}

export function Th({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "border-outline-variant text-on-surface-variant text-label-medium border-b px-3 py-2.5 text-left whitespace-nowrap",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  num,
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  num?: boolean;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        "border-outline-variant text-on-surface border-b px-3 py-2.5 text-left align-middle",
        num && "num",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({
  children,
  bad,
  className,
}: {
  children: ReactNode;
  bad?: boolean;
  className?: string;
}) {
  return (
    <tr
      className={cn(
        "hover:bg-on-surface/4 transition-colors duration-150",
        bad && "bg-error-container/50 hover:bg-error-container/70",
        className,
      )}
    >
      {children}
    </tr>
  );
}

/* ---------- Numeric cell: 3 decimals + bar ---------- */

/** Scores in 0–1 (like F1) are drawn this way so highs and lows are easy to scan.
 *  hi/lo coloring only applies when a red line is given — with no line there should
 *  be no implied pass/fail. */
export function ScoreCell({
  v,
  redLine,
}: {
  v?: number | null;
  redLine?: number | null;
}) {
  const width = Math.max(3, Math.round((v ?? 0) * 100));
  const hasLine = redLine !== null && redLine !== undefined;
  const tone = !hasLine
    ? "bg-primary"
    : (v ?? 0) >= redLine
      ? "bg-success"
      : "bg-error";
  return (
    <Td num>
      <div className="flex items-center justify-end gap-2">
        <span className="tabular-nums">
          {v === null || v === undefined ? "—" : v.toFixed(3)}
        </span>
        <span className="bg-surface-container-highest h-1.5 w-14 shrink-0 overflow-hidden rounded-full">
          <span
            className={cn(
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

export function KvBox({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="bg-surface-container-high text-on-surface-variant text-label-small min-w-[88px] rounded-md px-3 py-2">
      <b className="text-title-medium text-on-surface block font-medium tabular-nums">
        {value}
      </b>
      {label}
    </div>
  );
}

export function KvRow({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-wrap gap-2">{children}</div>;
}

/* ---------- Section heading ---------- */

export function SectionHead({
  children,
  unit,
  className,
}: {
  children: ReactNode;
  unit?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("text-title-small text-on-surface mt-5 mb-1.5", className)}
    >
      {children}
      {unit ? (
        <span className="text-on-surface-variant text-label-small ml-1.5 font-normal">
          {unit}
        </span>
      ) : null}
    </div>
  );
}
