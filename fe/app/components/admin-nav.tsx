import { Cat, MessageSquare } from "lucide-react";
import { motion } from "motion/react";
import { Link, useLocation } from "react-router";

import { ThemeToggle } from "./theme-toggle";

import { cn } from "~/lib/cn";
import { enterTransition, springTransition } from "~/lib/motion";

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
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={enterTransition}
      className="mt-4"
      aria-label="Admin navigation"
    >
      <div className="scroll-slim bg-card shadow-e1 flex items-center gap-1 overflow-x-auto rounded-lg p-1.5">
        <span className="bg-primary-container text-on-primary-container text-label-large mx-1 flex shrink-0 items-center gap-1.5 rounded-full py-1.5 pr-3.5 pl-2">
          <Cat className="h-4.5 w-4.5" aria-hidden />
          Admin
        </span>
        {NAV.map((m) => {
          const on = m === mod;
          return (
            <Link
              key={m.href}
              to={m.href}
              className={cn(
                "text-label-large relative flex shrink-0 items-center rounded-full px-4 py-2 whitespace-nowrap no-underline transition-colors duration-200",
                on
                  ? "text-on-secondary-container"
                  : "text-on-surface-variant hover:bg-on-surface/8 hover:text-on-surface",
              )}
              aria-current={on ? "page" : undefined}
            >
              {on ? (
                <motion.span
                  layoutId="admin-nav-pill"
                  className="bg-secondary-container absolute inset-0 rounded-full"
                  transition={springTransition}
                />
              ) : null}
              <span className="relative">{m.label}</span>
            </Link>
          );
        })}
        <span className="flex-1" />
        <Link
          to="/"
          className="text-label-large text-primary hover:bg-primary/8 flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 whitespace-nowrap no-underline transition-colors duration-200"
        >
          <MessageSquare className="h-4.5 w-4.5" aria-hidden />
          Chat
        </Link>
        <ThemeToggle className="mr-1 ml-0.5 shrink-0" />
      </div>
      {mod?.children ? (
        <div className="scroll-slim mt-2 flex gap-1 overflow-x-auto px-1">
          {mod.children.map(([href, label]) => {
            const on = href === path;
            return (
              <Link
                key={href}
                to={href}
                className={cn(
                  "text-label-medium relative shrink-0 rounded-full px-3.5 py-1.5 whitespace-nowrap no-underline transition-colors duration-200",
                  on
                    ? "text-primary"
                    : "text-on-surface-variant hover:bg-on-surface/8 hover:text-on-surface",
                )}
                aria-current={on ? "page" : undefined}
              >
                {label}
                {on ? (
                  <motion.span
                    layoutId="admin-subnav-line"
                    className="bg-primary absolute inset-x-3 -bottom-0.5 h-0.75 rounded-full"
                    transition={springTransition}
                  />
                ) : null}
              </Link>
            );
          })}
        </div>
      ) : null}
    </motion.nav>
  );
}
