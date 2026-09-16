import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "info" | "error";
interface ToastItem { id: number; msg: string; kind: ToastKind }
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
    setItems((xs) => [...xs.slice(-2), { id, msg, kind: isErr ? "error" : "info" }]);
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
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.18 }}
              className={
                "max-w-[84vw] border-3 px-4 py-2.5 text-[13px] font-bold shadow-hard-sm " +
                (t.kind === "error"
                  ? "border-ink bg-error text-white"
                  : "border-ink bg-ink text-cream")
              }
            >
              {t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
