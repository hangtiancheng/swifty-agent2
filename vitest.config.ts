import path from "node:path";

import { defineConfig } from "vitest/config";

const r = (p: string): string => path.resolve(import.meta.dirname, p);

export default defineConfig({
  resolve: {
    alias: {
      "@generated": r("generated"),
      "@scripts": r("scripts"),
      "@tests": r("tests"),
      "@": r("src"),
    },
  },
});
