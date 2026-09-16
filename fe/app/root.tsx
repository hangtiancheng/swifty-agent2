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
    cat before the JS bundle loads. Pure CSS animation — no JS dependency here. */
export function HydrateFallback() {
  return (
    <div className="bg-surface flex min-h-dvh flex-col items-center justify-center gap-6">
      <div className="bg-primary-container shadow-e2 grid h-24 w-24 place-items-center rounded-3xl">
        <Cat className="text-primary h-14 w-14" strokeWidth={1.5} />
      </div>
      <div className="flex flex-col items-center gap-3">
        <p className="text-title-medium text-on-surface">MeowMeow Select</p>
        <div className="bg-surface-container-highest relative h-1 w-40 overflow-hidden rounded-full">
          <div className="bg-primary animate-progress absolute inset-y-0 left-0 w-1/4 rounded-full" />
        </div>
      </div>
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
    <main className="bg-surface flex min-h-dvh items-center justify-center p-4">
      <div className="bg-card shadow-e3 w-full max-w-lg rounded-xl p-7">
        <div className="flex items-center gap-3.5">
          <span className="bg-primary-container grid h-12 w-12 shrink-0 place-items-center rounded-2xl">
            <Cat className="text-primary h-7 w-7" strokeWidth={1.5} />
          </span>
          <h1 className="text-headline-small text-on-surface font-medium">
            {message}
          </h1>
        </div>
        <p className="text-body-medium text-on-surface-variant mt-4 leading-6">
          {details}
        </p>
        {stack ? (
          <pre className="scroll-slim bg-surface-container-high text-on-surface-variant mt-4 max-h-64 overflow-auto rounded-md p-3.5 font-mono text-xs">
            <code>{stack}</code>
          </pre>
        ) : null}
        <a
          href="/"
          className="bg-primary text-on-primary hover:bg-primary-hover hover:shadow-e1 text-label-large mt-6 inline-flex h-10 items-center rounded-full px-6 no-underline transition-all duration-200 active:scale-[0.97]"
        >
          Back to chat
        </a>
      </div>
    </main>
  );
}
