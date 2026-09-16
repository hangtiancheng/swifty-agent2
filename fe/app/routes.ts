import {
  type RouteConfig,
  index,
  prefix,
  route,
} from "@react-router/dev/routes";

// One-to-one with the page routes of the original FastAPI app:
// / chat; /admin admin console; /kb knowledge base; /rag-eval RAG eval; /review review queue;
// /observability observability; /topics topic distribution; /topics/questions topic question list;
// /acceptance{,/eval,/data,/errors} the four acceptance pages
export default [
  index("routes/chat.tsx"),
  route("admin", "routes/admin.tsx"),
  route("kb", "routes/kb.tsx"),
  route("rag-eval", "routes/rageval.tsx"),
  route("review", "routes/review.tsx"),
  route("observability", "routes/observability.tsx"),
  route("topics", "routes/topics.tsx"),
  route("topics/questions", "routes/topic-questions.tsx"),
  ...prefix("acceptance", [
    index("routes/acceptance/index.tsx"),
    route("eval", "routes/acceptance/eval.tsx"),
    route("data", "routes/acceptance/data.tsx"),
    route("errors", "routes/acceptance/errors.tsx"),
  ]),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
