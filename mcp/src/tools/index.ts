import { githubModule } from "./github/tool.ts";
import type { ToolModule } from "./types.ts";

/** All tool modules hosted by this server. Add future modules here. */
export const modules: ToolModule[] = [githubModule];
