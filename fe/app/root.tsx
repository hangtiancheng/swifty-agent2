import { Cat } from "lucide-react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import "./app.css";
import type { Route } from "./+types/root";
import { ToastProvider } from "./components/toast";
import { THEME_INIT_SCRIPT } from "./lib/theme";

export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Decide light/dark before first paint to avoid a theme flash */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** SPA mode: this is baked into index.html at build time, so users see a waiting
    cat before the JS bundle loads. */
export function HydrateFallback() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5">
      <div className="border-ink bg-paper shadow-hard border-4 p-3">
        <Cat className="h-16 w-16" strokeWidth={1.5} />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="animate-blink bg-coral h-2.5 w-2.5" />
        <span className="animate-blink bg-coral h-2.5 w-2.5 [animation-delay:.2s]" />
        <span className="animate-blink bg-coral h-2.5 w-2.5 [animation-delay:.4s]" />
      </div>
      <p className="text-muted text-xs font-bold tracking-widest">
        MeowMeow Select · Loading…
      </p>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something went wrong";
  let details = "The page hit an unexpected error. Try refreshing.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Something went wrong";
    details =
      error.status === 404
        ? "This page does not exist. Head to the chat page or the admin overview."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="border-ink bg-cream shadow-hard-lg w-full max-w-lg border-4 p-6">
        <div className="flex items-center gap-3">
          <Cat className="h-10 w-10" strokeWidth={1.5} />
          <h1 className="text-xl font-bold tracking-wider">{message}</h1>
        </div>
        <p className="text-ink-soft mt-3 text-sm leading-7">{details}</p>
        {stack ? (
          <pre className="scroll-cat border-ink bg-paper mt-4 max-h-64 overflow-auto border-3 p-3 text-xs">
            <code>{stack}</code>
          </pre>
        ) : null}
        <a
          href="/"
          className="press border-ink bg-fur shadow-hard-sm mt-5 inline-block border-3 px-4 py-2 text-sm font-bold"
        >
          Back to chat →
        </a>
      </div>
    </main>
  );
}
