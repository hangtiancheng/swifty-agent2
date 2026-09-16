import { motion } from "motion/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";

import { AdminNav } from "./admin-nav";

import { cn } from "~/lib/cn";


/* ---------- 按钮 ---------- */

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

/** 按钮样式的链接(站内跳转) */
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

/* ---------- 状态药丸 ---------- */

export type PillTone =
  | "pass"
  | "fail"
  | "missing"
  | "running"
  | "info"
  | "sev-严"
  | "sev-中"
  | "sev-宽"
  | "plain";

const PILL_TONE: Record<PillTone, string> = {
  pass: "bg-online text-ink",
  fail: "bg-error text-white",
  missing: "border-muted bg-paper text-muted",
  running: "bg-fur text-ink",
  info: "bg-sky text-ink",
  "sev-严": "bg-coral text-white",
  "sev-中": "bg-fur text-ink",
  "sev-宽": "border-muted bg-paper text-muted",
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
        "inline-block whitespace-nowrap border-2.5 border-ink px-2 py-px text-[11.5px] font-bold",
        PILL_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------- 面板 / 顶栏 / 页面壳 ---------- */

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
        "mt-4 border-4 border-ink bg-cream p-3.5 shadow-hard sm:px-4.5 sm:py-4",
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
        <p className="mt-1 mb-3 text-[12.5px] leading-7 text-ink-soft">
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
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-4 border-ink bg-cream px-4 py-3.5 shadow-hard-lg">
      <h1 className="text-base font-bold tracking-wide sm:text-lg">{title}</h1>
      {sub ? <span className="text-xs text-muted">{sub}</span> : null}
      <span className="flex-1" />
      {children}
    </div>
  );
}

/** 后台页统一外壳:顶栏 + 导航 + 内容(带入场动效) */
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

/* ---------- 闸条统计 ---------- */

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
    <div className="min-w-[104px] border-3 border-ink bg-paper px-3.5 py-2 text-[12.5px] shadow-hard-sm">
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

/* ---------- 提示 / 占位 ---------- */

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
        "mt-3 border-3 border-dashed border-ink bg-paper px-3 py-2 text-[12.5px] leading-[1.8] [&_b]:border-2 [&_b]:border-ink [&_b]:bg-fur [&_b]:px-1 [&_b]:font-bold",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 产物缺失时的统一占位:说清楚缺什么、该跑哪个目标 */
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
        "border-3 border-dashed border-muted bg-paper p-3.5 text-center text-[12.5px] text-muted",
        className,
      )}
    >
      {children ?? "产物还没生成,先跑对应的 make 目标"}
    </div>
  );
}

/* ---------- 表格原语 ---------- */

export function TableScroll({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("scroll-cat overflow-x-auto", className)}>{children}</div>
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
      className={cn("w-full border-collapse bg-paper text-[12.5px]", className)}
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
        "border-2 border-ink bg-fur px-2 py-1.5 text-left text-xs font-bold whitespace-nowrap",
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
        "border-2 border-ink px-2 py-1.5 text-left align-middle",
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

/* ---------- 数值单元格:三位小数 + 横条 ---------- */

/** F1 这类 0~1 的分数统一这样画,能扫出高低。
 *  hi/lo 只在给了红线时才上色——没有线就不该有"及格/不及格"的暗示。 */
export function ScoreCell({
  v,
  redLine,
}: {
  v?: number | null;
  redLine?: number | null;
}) {
  const width = Math.max(2, Math.round((v ?? 0) * 100));
  const hasLine = redLine !== null && redLine !== undefined;
  const tone = !hasLine ? "bg-fur" : (v ?? 0) >= redLine ? "bg-online" : "bg-error";
  return (
    <Td num>
      <div className="flex items-center justify-end gap-1.5">
        <span className="tabular-nums">
          {v === null || v === undefined ? "—" : v.toFixed(3)}
        </span>
        <span className="h-2 w-[54px] shrink-0 border-2 border-ink bg-cream">
          <span
            className={cn("block h-full", tone)}
            style={{ width: `${width}%` }}
          />
        </span>
      </div>
    </Td>
  );
}

/* ---------- 小方块数值盒 ---------- */

export function KvBox({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="min-w-[84px] border-2 border-ink bg-paper px-2.5 py-1 text-[11.5px]">
      <b className="block text-[17px] leading-snug">{value}</b>
      {label}
    </div>
  );
}

export function KvRow({ children }: { children: ReactNode }) {
  return <div className="mt-2.5 flex flex-wrap gap-2">{children}</div>;
}

/* ---------- 小标题 ---------- */

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
      className={cn("mt-4 mb-0.5 text-[13px] font-bold", className)}
    >
      {children}
      {unit ? (
        <span className="ml-1.5 text-[11.5px] font-normal text-muted">
          {unit}
        </span>
      ) : null}
    </div>
  );
}
