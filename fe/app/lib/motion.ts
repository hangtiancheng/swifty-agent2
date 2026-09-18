import { animate } from "motion";

/* Shared motion presets so every transition in the app comes from one family:
   entrances decelerate, exits accelerate, morphs spring. Values mirror the
   --ease-* curves in app.css (which CSS transitions use). Built on motion's
   framework-agnostic animate() — no React bindings. */

export type Bezier = [number, number, number, number];

export const EASE_STANDARD: Bezier = [0.2, 0, 0, 1];
export const EASE_DECEL: Bezier = [0.05, 0.7, 0.1, 1];
export const EASE_ACCEL: Bezier = [0.3, 0, 0.8, 0.15];

/** Entrance/appear: travels in and settles */
export const enterTransition = { duration: 0.35, ease: EASE_DECEL };

/** Exit/dismiss: short, leaves with speed */
export const exitTransition = { duration: 0.2, ease: EASE_ACCEL };

/** Small in-place morph (indicators, pills): quick and snappy */
export const springTransition = {
  type: "spring",
  stiffness: 520,
  damping: 38,
  mass: 0.9,
} as const;

/** Larger surfaces (drawers, dialogs): soft spring without bounce */
export const softSpring = {
  type: "spring",
  stiffness: 320,
  damping: 34,
  mass: 1,
} as const;

/* ---------- Imperative helpers for Lit elements ---------- */

export interface EnterOptions {
  delay?: number;
  duration?: number;
  y?: number;
  x?: number;
  scale?: number;
  ease?: Bezier;
}

/** Animate an element in (opacity + optional travel/scale). The element's resting
    CSS state is "visible", so a dropped animation never leaves it hidden. */
export function fxEnter(el: HTMLElement, opts: EnterOptions = {}): void {
  const {
    delay = 0,
    duration = 0.35,
    y = 0,
    x = 0,
    scale = 0,
    ease = EASE_DECEL,
  } = opts;
  const keyframes: Record<string, number[]> = { opacity: [0, 1] };
  if (y !== 0) {
    keyframes.y = [y, 0];
  }
  if (x !== 0) {
    keyframes.x = [x, 0];
  }
  if (scale !== 0) {
    keyframes.scale = [scale, 1];
  }
  animate(el, keyframes, { delay, duration, ease });
}

const entered = new WeakSet<Element>();

/** ref-callback friendly: run fxEnter once per element instance (re-runs if the
    element is removed and a fresh one mounts — same semantics as a React remount). */
export function enterOnce(el: Element | undefined, opts?: EnterOptions): void {
  if (el instanceof HTMLElement && !entered.has(el)) {
    entered.add(el);
    fxEnter(el, opts);
  }
}

/** Animate an element out; resolves when the exit finishes so the caller can
    remove it from the DOM/state afterwards. */
export function fxOut(
  el: HTMLElement,
  opts: {
    duration?: number;
    y?: number;
    x?: number;
    scale?: number;
    ease?: Bezier;
  } = {},
): Promise<void> {
  const { duration = 0.2, y = 0, x = 0, scale = 1, ease = EASE_ACCEL } = opts;
  const keyframes: Record<string, number[]> = { opacity: [1, 0] };
  if (y !== 0) {
    keyframes.y = [0, y];
  }
  if (x !== 0) {
    keyframes.x = [0, x];
  }
  if (scale !== 1) {
    keyframes.scale = [1, scale];
  }
  const controls = animate(el, keyframes, { duration, ease });
  return controls.then(() => undefined);
}

/** Grow a bar from 0 to its final width. The final width is committed to the
    inline style up front, so the bar keeps its value even if the animation is
    interrupted (WAAPI keyframes override the style only while playing). */
export function fxWidth(
  el: HTMLElement,
  to: string,
  opts: { duration?: number; delay?: number; ease?: Bezier } = {},
): void {
  const { duration = 0.45, delay = 0, ease = EASE_DECEL } = opts;
  el.style.width = to;
  animate(el, { width: ["0%", to] }, { duration, delay, ease });
}

/** ref-callback friendly fxWidth for JSX use. */
export function growOnce(
  el: Element | undefined,
  to: string,
  opts?: { duration?: number; delay?: number },
): void {
  if (el instanceof HTMLElement && !entered.has(el)) {
    entered.add(el);
    fxWidth(el, to, opts);
  }
}
