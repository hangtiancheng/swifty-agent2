// Single Prisma client bound to the SQLite file from DATABASE_URL.
import fs from "node:fs";
import path from "node:path";

import { PrismaClient } from "#generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { settings } from "#/config.ts";

function ensureSqliteDir(url: string): void {
  const file = url.replace(/^file:/, "");
  if (file === ":memory:") {
    return;
  }
  const dir = path.dirname(path.resolve(settings.root, file));
  fs.mkdirSync(dir, { recursive: true });
}

ensureSqliteDir(settings.databaseUrl);

const adapter = new PrismaBetterSqlite3({ url: settings.databaseUrl });
export const prisma = new PrismaClient({ adapter });

export async function closeDb(): Promise<void> {
  await prisma.$disconnect();
}
