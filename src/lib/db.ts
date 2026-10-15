// Legacy scaffold data layer (User/Post models) — kept for the db:* scripts;
// the dashboard's live data comes from the engine API (src/lib/agent-api.ts).
// Prisma 7: driver-adapter client generated into src/generated/prisma.
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: process.env.DATABASE_URL ?? "file:./db/custom.db",
    }),
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
