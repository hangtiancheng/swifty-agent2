// Entry point: validate runtime configuration, register builtin tools, start the server.
import { missingRuntimeConfig, settings } from "./config.ts";
import { childLogger } from "./logger.ts";
import { startServer } from "./server.ts";
import { scanBuiltin } from "./tools/registry.ts";

const log = childLogger("main");

const missing = missingRuntimeConfig();
if (missing.length > 0) {
  log.error(
    { missing },
    `missing required upstream configuration: ${missing.join(", ")}; fill .env (see .env.example)`,
  );
  process.exit(1);
}

await scanBuiltin();
log.info({ root: settings.root }, "starting swifty-agent2 server");
startServer();
