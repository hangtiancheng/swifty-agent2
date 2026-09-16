import { defineConfig } from "prisma/config";

// Load .env when present so CLI commands (db push / generate) use the same database path
// as the runtime configuration.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file; fall through to the default
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./data/swifty-agent2.db",
  },
});
