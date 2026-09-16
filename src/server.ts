// Hono application: middleware, API routes and the startup/shutdown lifecycle.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { pinoLogger } from "hono-pino";

import { acceptanceRouter } from "./api/acceptance.ts";
import { actionsRouter } from "./api/actions.ts";
import { adminRouter } from "./api/admin.ts";
import { agentRouter } from "./api/agent.ts";
import { chatRouter } from "./api/chat.ts";
import { conversationsRouter } from "./api/conversations.ts";
import { extractRouter } from "./api/extract.ts";
import { feedbackRouter } from "./api/feedback.ts";
import { jobsRouter } from "./api/jobs.ts";
import { kbRouter } from "./api/kb.ts";
import { observabilityRouter } from "./api/observability.ts";
import { ragevalRouter } from "./api/rageval.ts";
import { reviewRouter } from "./api/review.ts";
import { topicsRouter } from "./api/topics.ts";
import { settings } from "./config.ts";
import * as budget from "./core/budget.ts";
import * as jobs from "./core/jobs.ts";
import { initObservability, shutdownObservability } from "./core/observability.ts";
import { closeDb } from "./db/client.ts";
import * as runtime from "./graph/runtime.ts";
import { childLogger, logger } from "./logger.ts";

const log = childLogger("server");

export function createApp(): Hono {
  const app = new Hono();
  app.use(pinoLogger({ pino: logger }));

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.route("/", acceptanceRouter);
  app.route("/", actionsRouter);
  app.route("/", adminRouter);
  app.route("/", agentRouter);
  app.route("/", chatRouter);
  app.route("/", conversationsRouter);
  app.route("/", extractRouter);
  app.route("/", feedbackRouter);
  app.route("/", jobsRouter);
  app.route("/", kbRouter);
  app.route("/", observabilityRouter);
  app.route("/", ragevalRouter);
  app.route("/", reviewRouter);
  app.route("/", topicsRouter);

  app.notFound((c) => c.json({ detail: `Not Found: ${c.req.path}` }, 404));
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ detail: error.message }, error.status);
    }
    log.error({ err: error, path: c.req.path }, "unhandled error");
    return c.json({ detail: "Internal server error; please try again later" }, 500);
  });
  return app;
}

function checkContextBudget(): void {
  const b = budget.compute();
  if (b.healthy) {
    log.info({ budget: budget.describe(b) }, "context budget ok");
  } else {
    log.error(
      {
        budget: budget.describe(b),
        window: b.window,
        fixed: b.fixed,
        peak: b.peak,
      },
      "context budget too small; raise MODEL_CONTEXT_WINDOW or lower MAX_AGENT_STEPS / " +
        "TOOL_RESULT_MAX_TOKENS / MAX_OUTPUT_TOKENS / RERANK_TOP_K",
    );
  }
}

export function startServer(): void {
  initObservability();
  checkContextBudget();
  runtime.initGraph();
  const app = createApp();
  const server = serve({ fetch: app.fetch, port: settings.port, hostname: "0.0.0.0" });

  const shutdown = (signal: string): void => {
    log.info({ signal }, "shutting down");
    server.close(() => {
      void shutdownObservability()
        .then(() => closeDb())
        .catch((error: unknown) => {
          log.warn({ err: error }, "shutdown cleanup failed");
        })
        .finally(() => {
          runtime.closeGraph();
          process.exit(0);
        });
    });
  };
  process.once("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  log.info({ port: settings.port, jobs: Object.keys(jobs.JOBS).length }, "server listening");
}
