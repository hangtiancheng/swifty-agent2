import type { Transition } from "motion/react";

/* Shared motion presets so every transition in the app comes from one family:
   entrances decelerate, exits accelerate, morphs spring. Values mirror the
   --ease-* curves in app.css (which CSS transitions use). */

export const EASE_STANDARD: [number, number, number, number] = [0.2, 0, 0, 1];
export const EASE_DECEL: [number, number, number, number] = [0.05, 0.7, 0.1, 1];
export const EASE_ACCEL: [number, number, number, number] = [0.3, 0, 0.8, 0.15];

/** Entrance/appear: travels in and settles */
export const enterTransition: Transition = { duration: 0.35, ease: EASE_DECEL };

/** Exit/dismiss: short, leaves with speed */
export const exitTransition: Transition = { duration: 0.2, ease: EASE_ACCEL };

/** Small in-place morph (indicators, pills): quick and snappy */
export const springTransition: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 38,
  mass: 0.9,
};

/** Larger surfaces (drawers, dialogs): soft spring without bounce */
export const softSpring: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 34,
  mass: 1,
};
