import { motion } from "motion/react";
import { Link, useLocation } from "react-router";

import { ThemeToggle } from "./theme-toggle";

import { cn } from "~/lib/cn";


/* 后台导航外壳:一份导航挂在所有后台页上(原 admin.js)。
   模块入口都是各章原本的路径,导航只是把它们收到一处,不做跳转改写。 */

interface NavModule {
  href: string;
  label: string;
  children?: [string, string][];
}

const NAV: NavModule[] = [
  { href: "/admin", label: "后台首页" },
  { href: "/kb", label: "知识库录入" },
  { href: "/rag-eval", label: "RAG 评估" },
  { href: "/review", label: "飞轮待审" },
  { href: "/observability", label: "观测与成本" },
  { href: "/topics", label: "主题分布" },
  {
    href: "/acceptance",
    label: "分类器验收",
    children: [
      ["/acceptance", "总览"],
      ["/acceptance/eval", "评测详情"],
      ["/acceptance/data", "数据产物"],
      ["/acceptance/errors", "错例复核"],
    ],
  },
];

/** 当前页归属哪个模块:精确命中优先,其次按前缀(/acceptance/eval 归 /acceptance) */
function moduleOf(active: string): NavModule | undefined {
  return (
    NAV.find((m) => m.href === active) ??
    NAV.find((m) => m.href !== "/" && active.startsWith(m.href + "/"))
  );
}

export function AdminNav({ active }: { active: string }) {
  const location = useLocation();
  const path = active || location.pathname;
  const mod = moduleOf(path);

  return (
    <motion.nav
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mt-3"
      aria-label="后台导航"
    >
      <div className="scroll-cat flex items-stretch overflow-x-auto border-3 border-ink bg-paper shadow-hard-sm">
        <span className="flex shrink-0 items-center bg-ink px-3 py-1.5 text-xs font-bold tracking-wider whitespace-nowrap text-cream">
          后台管理
        </span>
        {NAV.map((m) => {
          const on = m === mod;
          return (
            <Link
              key={m.href}
              to={m.href}
              className={cn(
                "relative flex shrink-0 items-center gap-1.5 border-r-3 border-ink px-3 py-1.5 text-[13px] font-bold whitespace-nowrap no-underline text-ink hover:bg-fur-hover",
                on && "bg-fur hover:bg-fur",
              )}
              aria-current={on ? "page" : undefined}
            >
              {m.label}
              {on ? (
                <motion.span
                  layoutId="admin-nav-dot"
                  className="absolute inset-x-2 bottom-0 h-0.5 bg-ink"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              ) : null}
            </Link>
          );
        })}
        <span className="min-w-2 flex-1 border-r-3 border-ink max-sm:hidden" />
        <Link
          to="/"
          className="flex shrink-0 items-center px-3 py-1.5 text-[13px] font-bold whitespace-nowrap no-underline text-ink hover:bg-fur-hover"
        >
          聊天页 →
        </Link>
        <span className="flex shrink-0 items-center border-l-3 border-ink px-2">
          <ThemeToggle className="h-7 w-7 border-2 shadow-none" />
        </span>
      </div>
      {mod?.children ? (
        <div className="scroll-cat flex overflow-x-auto border-3 border-t-0 border-ink bg-cream shadow-hard-sm">
          {mod.children.map(([href, label]) => {
            const on = href === path;
            return (
              <Link
                key={href}
                to={href}
                className={cn(
                  "shrink-0 border-r-3 border-ink px-3 py-1 text-xs font-bold whitespace-nowrap no-underline text-ink last:border-r-0 hover:bg-fur-hover",
                  on && "bg-fur hover:bg-fur",
                )}
                aria-current={on ? "page" : undefined}
              >
                {label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </motion.nav>
  );
}
