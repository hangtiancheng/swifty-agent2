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
        "press-sm grid h-8 w-8 shrink-0 cursor-pointer place-items-center border-3 border-ink bg-paper text-ink shadow-hard-xs hover:bg-fur-hover",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ rotate: -90, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          exit={{ rotate: 90, opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="grid place-items-center"
        >
          {dark ? (
            <Moon className="h-4 w-4" aria-hidden />
          ) : (
            <Sun className="h-4 w-4" aria-hidden />
          )}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
