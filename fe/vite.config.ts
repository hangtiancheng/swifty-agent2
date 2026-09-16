import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },

  server: {
    proxy: {
      // The app only calls /api/*; the backend (Hono) listens on 127.0.0.1:8000
      // by default. SSE streams (POST /api/chat) pass through unchanged.
      "/api": {
        target: process.env.BACKEND_URL ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
