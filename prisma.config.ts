// Prisma 7 configuration — replaces the schema-level `url = env(...)` for the
// CLI (db push / migrate / generate resolve the datasource from here).
// The dashboard client connects through the better-sqlite3 driver adapter
// (see src/lib/db.ts); DATABASE_URL stays the single source for the runtime.
import { defineConfig } from "prisma/config";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const repoRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  schema: join(repoRoot, "prisma", "schema.prisma"),
  migrations: {
    path: join(repoRoot, "prisma", "migrations"),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? `file:${join(repoRoot, "db", "custom.db")}`,
  },
});
