import { Moon, Sun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "~/lib/cn";
import { toggleTheme, useTheme } from "~/lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "text-on-surface-variant hover:bg-on-surface/8 active:bg-on-surface/12 grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-200",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ rotate: -60, opacity: 0, scale: 0.7 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 60, opacity: 0, scale: 0.7 }}
          transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
          className="grid place-items-center"
        >
          {dark ? (
            <Moon className="h-5 w-5" aria-hidden />
          ) : (
            <Sun className="h-5 w-5" aria-hidden />
          )}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
