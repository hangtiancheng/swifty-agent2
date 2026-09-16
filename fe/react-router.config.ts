import type { Config } from "@react-router/dev/config";

export default {
  // 纯客户端应用(原 FastAPI 静态页迁移):SPA 模式,构建期预渲染 root 生成 index.html,
  // 运行期不做服务端渲染。部署时把所有路径指到 index.html 即可。
  ssr: false,
} satisfies Config;
