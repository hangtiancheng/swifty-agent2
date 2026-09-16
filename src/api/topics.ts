// Topic distribution API (read-only; population happens in the classifier pipeline).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { parseQuery } from "./http.ts";

import { TOPIC_NAMES } from "#/core/taxonomy.ts";
import * as repository from "#/db/repository.ts";

export const topicsRouter = new Hono();

const questionsQuerySchema = z.object({
  label: z.string().min(1, "label must not be empty"),
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
    throw new HTTPException(400, {
      message: `Unknown topic "${query.label}"; the authoritative taxonomy has ${TOPIC_NAMES.length} classes`,
    });
  }
  return Response.json(
    await repository.topicQuestions(query.label, query.page, query.size),
  );
});
