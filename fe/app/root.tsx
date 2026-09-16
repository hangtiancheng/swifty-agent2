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
import { CatIcon } from "./components/cat-icon";
import { ToastProvider } from "./components/toast";
import { THEME_INIT_SCRIPT } from "./lib/theme";


export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* 首帧前决定明暗,避免主题闪烁 */}
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

/** SPA 模式:构建期把这段烤进 index.html,JS 加载前先给用户一只等待中的猫 */
export function HydrateFallback() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5">
      <div className="border-4 border-ink bg-paper p-3 shadow-hard">
        <CatIcon className="h-16 w-16" />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 animate-blink bg-coral" />
        <span className="h-2.5 w-2.5 animate-blink bg-coral [animation-delay:.2s]" />
        <span className="h-2.5 w-2.5 animate-blink bg-coral [animation-delay:.4s]" />
      </div>
      <p className="text-xs font-bold tracking-widest text-muted">
        喵喵优选 · 加载中…
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
  let message = "出错了";
  let details = "页面遇到了意外错误,刷新试试喵~";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "出错了";
    details =
      error.status === 404
        ? "这个页面不存在,去聊天页或后台首页看看。"
        : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-lg border-4 border-ink bg-cream p-6 shadow-hard-lg">
        <div className="flex items-center gap-3">
          <CatIcon className="h-10 w-10" />
          <h1 className="text-xl font-bold tracking-wider">{message}</h1>
        </div>
        <p className="mt-3 text-sm leading-7 text-ink-soft">{details}</p>
        {stack ? (
          <pre className="scroll-cat mt-4 max-h-64 overflow-auto border-3 border-ink bg-paper p-3 text-xs">
            <code>{stack}</code>
          </pre>
        ) : null}
        <a
          href="/"
          className="press mt-5 inline-block border-3 border-ink bg-fur px-4 py-2 text-sm font-bold shadow-hard-sm"
        >
          回聊天页 →
        </a>
      </div>
    </main>
  );
}
