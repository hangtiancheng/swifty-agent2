import { CircleAlert, CircleCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "~/lib/cn";
import { EASE_DECEL } from "~/lib/motion";

type ToastKind = "info" | "error";
interface ToastItem {
  id: number;
  msg: string;
  kind: ToastKind;
}
export type ToastFn = (msg: string, isErr?: boolean) => void;

const ToastCtx = createContext<ToastFn>(() => undefined);

export function useToast(): ToastFn {
  return useContext(ToastCtx);
}

/** Global toast: bottom-center, stacks up to three, auto-dismisses after 3.6s.
    The original had one #toast per page; here it lives once in root. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const toast = useCallback<ToastFn>((msg, isErr) => {
    const id = nextId.current++;
    setItems((xs) => [
      ...xs.slice(-2),
      { id, msg, kind: isErr ? "error" : "info" },
    ]);
    window.setTimeout(() => {
      setItems((xs) => xs.filter((x) => x.id !== id));
    }, 3600);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-7 z-[99] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 28, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.3, ease: EASE_DECEL }}
              className={cn(
                "text-label-large shadow-e3 pointer-events-auto flex max-w-[84vw] items-center gap-2.5 rounded-md px-4 py-3",
                t.kind === "error"
                  ? "bg-error-container text-on-error-container"
                  : "bg-inverse-surface text-inverse-on-surface",
              )}
            >
              {t.kind === "error" ? (
                <CircleAlert className="h-4.5 w-4.5 shrink-0" aria-hidden />
              ) : (
                <CircleCheck className="h-4.5 w-4.5 shrink-0" aria-hidden />
              )}
              {t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
