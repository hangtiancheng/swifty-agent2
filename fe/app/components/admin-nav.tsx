import { motion } from "motion/react";
import { Link, useLocation } from "react-router";

import { ThemeToggle } from "./theme-toggle";

import { cn } from "~/lib/cn";

/* Admin navigation shell: a single nav bar shared by every admin page (from the
   original admin.js). Entries keep each module's own path; the nav only gathers
   them in one place and does not rewrite any routes. */

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
      aria-label="Admin navigation"
    >
      <div className="scroll-cat border-ink bg-paper shadow-hard-sm flex items-stretch overflow-x-auto border-3">
        <span className="bg-ink text-cream flex shrink-0 items-center px-3 py-1.5 text-xs font-bold tracking-wider whitespace-nowrap">
          Admin
        </span>
        {NAV.map((m) => {
          const on = m === mod;
          return (
            <Link
              key={m.href}
              to={m.href}
              className={cn(
                "border-ink text-ink hover:bg-fur-hover relative flex shrink-0 items-center gap-1.5 border-r-3 px-3 py-1.5 text-[13px] font-bold whitespace-nowrap no-underline",
                on && "bg-fur hover:bg-fur",
              )}
              aria-current={on ? "page" : undefined}
            >
              {m.label}
              {on ? (
                <motion.span
                  layoutId="admin-nav-dot"
                  className="bg-ink absolute inset-x-2 bottom-0 h-0.5"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              ) : null}
            </Link>
          );
        })}
        <span className="border-ink min-w-2 flex-1 border-r-3 max-sm:hidden" />
        <Link
          to="/"
          className="text-ink hover:bg-fur-hover flex shrink-0 items-center px-3 py-1.5 text-[13px] font-bold whitespace-nowrap no-underline"
        >
          Chat →
        </Link>
        <span className="border-ink flex shrink-0 items-center border-l-3 px-2">
          <ThemeToggle className="h-7 w-7 border-2 shadow-none" />
        </span>
      </div>
      {mod?.children ? (
        <div className="scroll-cat border-ink bg-cream shadow-hard-sm flex overflow-x-auto border-3 border-t-0">
          {mod.children.map(([href, label]) => {
            const on = href === path;
            return (
              <Link
                key={href}
                to={href}
                className={cn(
                  "border-ink text-ink hover:bg-fur-hover shrink-0 border-r-3 px-3 py-1 text-xs font-bold whitespace-nowrap no-underline last:border-r-0",
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
