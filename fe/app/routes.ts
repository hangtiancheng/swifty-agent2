import {
  type RouteConfig,
  index,
  prefix,
  route,
} from "@react-router/dev/routes";

// 与原 FastAPI 工程的页面路由一一对应:
// / 聊天页;/admin 后台首页;/kb 知识库;/rag-eval RAG 评估;/review 飞轮待审;
// /observability 观测与成本;/topics 主题分布;/topics/questions 类目问题列表;
// /acceptance{,/eval,/data,/errors} 分类器验收四页
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
