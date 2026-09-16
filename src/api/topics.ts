// Topic distribution API (read-only; population happens in the classifier pipeline).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { TOPIC_NAMES } from "../core/taxonomy.ts";
import * as repository from "../db/repository.ts";

import { parseQuery } from "./http.ts";

export const topicsRouter = new Hono();

const questionsQuerySchema = z.object({
  label: z.string().min(1, "label 不能为空"),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
});

topicsRouter.get("/api/topics/distribution", async () => {
  return Response.json(await repository.topicDistribution());
});

topicsRouter.get("/api/topics/questions", async (c) => {
  const query = parseQuery(c, questionsQuerySchema);
  // A label outside the authoritative list is a typo or a stale link: say so instead of an empty page.
  if (!TOPIC_NAMES.includes(query.label)) {
    throw new HTTPException(400, { message: `未知类目「${query.label}」,权威类目共 ${TOPIC_NAMES.length} 类` });
  }
  return Response.json(await repository.topicQuestions(query.label, query.page, query.size));
});
