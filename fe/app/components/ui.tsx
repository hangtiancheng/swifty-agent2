import { motion } from "motion/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";

import { AdminNav } from "./admin-nav";

import { cn } from "~/lib/cn";

/* ---------- Buttons ---------- */

type BtnVariant = "default" | "go" | "no" | "ok";
type BtnSize = "md" | "sm";

const BTN_BASE =
  "press inline-flex cursor-pointer items-center justify-center gap-1.5 border-3 border-ink font-bold " +
  "disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:active:transform-none";
const BTN_SIZE: Record<BtnSize, string> = {
  md: "press px-3.5 py-1.5 text-[13px] shadow-hard-sm",
  sm: "press-sm px-2.5 py-1 text-xs shadow-hard-xs",
};
const BTN_VARIANT: Record<BtnVariant, string> = {
  default: "bg-paper text-ink hover:bg-fur-hover",
  go: "bg-fur text-ink hover:brightness-105",
  no: "bg-error text-white hover:brightness-105",
  ok: "bg-online text-ink hover:brightness-105",
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
  pass: "bg-online text-ink",
  fail: "bg-error text-white",
  missing: "border-muted bg-paper text-muted",
  running: "bg-fur text-ink",
  info: "bg-sky text-ink",
  "sev-strict": "bg-coral text-white",
  "sev-medium": "bg-fur text-ink",
  "sev-lenient": "border-muted bg-paper text-muted",
  plain: "bg-paper text-ink",
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
        "border-2.5 border-ink inline-block px-2 py-px text-[11.5px] font-bold whitespace-nowrap",
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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className={cn(
        "border-ink bg-cream shadow-hard mt-4 border-4 p-3.5 sm:px-4.5 sm:py-4",
        tight && "pb-3.5",
        className,
      )}
    >
      {title ? (
        <h2 className="flex flex-wrap items-center gap-2.5 text-sm font-bold">
          {title}
          {pill}
        </h2>
      ) : null}
      {lede ? (
        <p className="text-ink-soft mt-1 mb-3 text-[12.5px] leading-7">
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
    <div className="border-ink bg-cream shadow-hard-lg flex flex-wrap items-center gap-x-3.5 gap-y-2 border-4 px-4 py-3.5">
      <h1 className="text-base font-bold tracking-wide sm:text-lg">{title}</h1>
      {sub ? <span className="text-muted text-xs">{sub}</span> : null}
      <span className="flex-1" />
      {children}
    </div>
  );
}

/** Shared shell for admin pages: top bar + nav + content (with entrance animation) */
export function PageShell({
  title,
  sub,
  active,
  actions,
  maxW = "max-w-[1180px]",
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
    <div className={cn("mx-auto px-3 pt-5 pb-16 sm:px-4", maxW)}>
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
    <div className="border-ink bg-paper shadow-hard-sm min-w-[104px] border-3 px-3.5 py-2 text-[12.5px]">
      <span>{label}</span>
      <b
        className={cn(
          "block text-xl leading-snug",
          small && "text-[15px] leading-8",
          tone === "pass" && "text-online-deep",
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
        "border-ink bg-paper [&_b]:border-ink [&_b]:bg-fur mt-3 border-3 border-dashed px-3 py-2 text-[12.5px] leading-[1.8] [&_b]:border-2 [&_b]:px-1 [&_b]:font-bold",
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
        "border-muted bg-paper text-muted border-3 border-dashed p-3.5 text-center text-[12.5px]",
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
    <div className={cn("scroll-cat overflow-x-auto", className)}>
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
      className={cn("bg-paper w-full border-collapse text-[12.5px]", className)}
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
        "border-ink bg-fur border-2 px-2 py-1.5 text-left text-xs font-bold whitespace-nowrap",
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
        "border-ink border-2 px-2 py-1.5 text-left align-middle",
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
  return <tr className={cn(bad && "bg-error-bg", className)}>{children}</tr>;
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
  const width = Math.max(2, Math.round((v ?? 0) * 100));
  const hasLine = redLine !== null && redLine !== undefined;
  const tone = !hasLine
    ? "bg-fur"
    : (v ?? 0) >= redLine
      ? "bg-online"
      : "bg-error";
  return (
    <Td num>
      <div className="flex items-center justify-end gap-1.5">
        <span className="tabular-nums">
          {v === null || v === undefined ? "—" : v.toFixed(3)}
        </span>
        <span className="border-ink bg-cream h-2 w-[54px] shrink-0 border-2">
          <span
            className={cn("block h-full", tone)}
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
    <div className="border-ink bg-paper min-w-[84px] border-2 px-2.5 py-1 text-[11.5px]">
      <b className="block text-[17px] leading-snug">{value}</b>
      {label}
    </div>
  );
}

export function KvRow({ children }: { children: ReactNode }) {
  return <div className="mt-2.5 flex flex-wrap gap-2">{children}</div>;
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
    <div className={cn("mt-4 mb-0.5 text-[13px] font-bold", className)}>
      {children}
      {unit ? (
        <span className="text-muted ml-1.5 text-[11.5px] font-normal">
          {unit}
        </span>
      ) : null}
    </div>
  );
}
