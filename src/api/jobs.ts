// Job API: the only entry point for the admin "re-run" buttons (start / status+log tail / stop).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import * as jobs from "../core/jobs.ts";

export const jobsRouter = new Hono();

function known(name: string): void {
  if (!(name in jobs.JOBS)) {
    throw new HTTPException(404, { message: `未注册的作业:${name}` });
  }
}

jobsRouter.get("/api/jobs", (c) => c.json({ jobs: jobs.statusAll() }));

jobsRouter.post("/api/jobs/:name", (c) => {
  const name = c.req.param("name");
  known(name);
  try {
    jobs.start(name);
  } catch (error) {
    const message = error instanceof Error ? error.message : "作业启动失败";
    throw new HTTPException(message.includes("正在运行中") ? 409 : 500, { message });
  }
  return c.json(jobs.status(name, true));
});

jobsRouter.get("/api/jobs/:name", (c) => {
  const name = c.req.param("name");
  known(name);
  return c.json(jobs.status(name, true));
});

jobsRouter.post("/api/jobs/:name/stop", async (c) => {
  const name = c.req.param("name");
  known(name);
  try {
    await jobs.stop(name);
  } catch (error) {
    const message = error instanceof Error ? error.message : "作业停止失败";
    throw new HTTPException(409, { message });
  }
  return c.json(jobs.status(name, true));
});
