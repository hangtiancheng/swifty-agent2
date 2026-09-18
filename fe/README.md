# MeowMeow Select — Frontend

CSR-only SPA for the MeowMeow Select customer-support agent console: an AI chat
page plus the admin pages (Knowledge Base, RAG eval, review queue,
observability, topics, classifier acceptance).

## Stack

| Concern              | Choice                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Components           | [Lit](https://lit.dev) + [`@swifty.js/lit-jsx`](https://www.npmjs.com/package/@swifty.js/lit-jsx) (React-style JSX that compiles to lit-html templates) |
| Routing              | [`@lit-labs/router`](https://www.npmjs.com/package/@lit-labs/router) (pathname routes; query strings ride `location.search`)                            |
| Styling              | [Tailwind CSS v4](https://tailwindcss.com) (`@tailwindcss/vite`), Material-style design tokens in `app/app.css`, class-based dark mode                  |
| Animation            | [`motion`](https://motion.dev) framework-agnostic `animate()` (see `app/lib/motion.ts`)                                                                 |
| Charts               | [Chart.js](https://www.chartjs.org) (`app/components/charts.tsx`)                                                                                       |
| Decorative animation | [LottieFiles dotLottie](https://lottiefiles.com) via `@lottiefiles/dotlottie-web`; assets in `public/lottie/`, self-hosted WASM in `public/wasm/`       |
| Icons                | [`lucide-static`](https://lucide.dev) raw SVGs (`app/lib/icons.ts`)                                                                                     |
| Build                | [Vite](https://vite.dev) (no SSR, no server bundle)                                                                                                     |

## Getting started

```bash
pnpm install        # from the repo root (pnpm workspace)
pnpm --filter fe dev
```

The dev server runs on http://localhost:5173 and proxies `/api/*` to the
backend at `http://127.0.0.1:8000` (override with `BACKEND_URL`). Start the
backend from the repo root with `pnpm dev`.

## Scripts (in `fe/`)

| Script           | Purpose                       |
| ---------------- | ----------------------------- |
| `pnpm dev`       | Vite dev server with HMR      |
| `pnpm build`     | Production build into `dist/` |
| `pnpm preview`   | Serve the production build    |
| `pnpm start`     | `vite preview` on port 3000   |
| `pnpm typecheck` | `tsc --noEmit`                |

Deploy `dist/` behind any static file server with an SPA fallback (all paths →
`index.html`).

## Architecture notes

- **Light DOM everywhere.** Every element extends `LightElement`
  (`app/lib/light-element.ts`), which renders into the light DOM so the global
  Tailwind stylesheet applies (shadow roots would not see it).
- **Pages are self-loading elements.** `DataLoaderElement`
  (`app/lib/page-element.tsx`) replaces React Router's `clientLoader` +
  `useRevalidator`: load on connect, `reload()` for the Refresh button and
  job-finish callbacks, `loading`/`loadError`/`data` drive the three UI states.
- **Routing & query strings.** `@lit-labs/router` matches pathnames only; its
  click interceptor pushes the full href but feeds `goto()` the pathname.
  Pages that depend on the query string (`/review?status=`,
  `/topics/questions?label=&page=`) receive `location.search` as a `search`
  property from their route render callback (`app/components/app-shell.tsx`)
  and reload when it changes. Programmatic navigation goes through
  `navigate()` in `app/lib/router.ts`.
- **Inputs are uncontrolled.** lit-jsx commits props as property writes, so a
  controlled `value` binding would re-write `.value` on every keystroke and
  reset the caret. Text inputs/textareas keep state in the DOM; element state
  mirrors it via `onInput`, and programmatic edits (presets, resets) write
  through `createRef` refs.
- **Chat.** `app/routes/chat.tsx` owns the conversation state (SSE streaming,
  interrupts, actions, feedback) that the React version kept in the `useChat`
  hook; `<message-bubble>` elements only re-render when their own `msg` object
  changes (Lit property identity = React.memo).
- **Theme.** Class-based `.dark` on `<html>`; an inline script in `index.html`
  applies it before first paint; `app/lib/theme.ts` is the store.

## Routes

`/` chat · `/admin` console · `/kb` knowledge base · `/rag-eval` · `/review`
· `/observability` · `/topics` · `/topics/questions` · `/acceptance`
(+ `/eval`, `/data`, `/errors`) · anything else → 404 page.
