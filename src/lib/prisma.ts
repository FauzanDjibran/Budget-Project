import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaCtor: typeof PrismaClient | undefined;
};

function createClient() {
  // Prisma 7 connects through a driver adapter rather than a bundled engine.
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Next.js dev server hot-reloads modules, which would otherwise open a new pool
// on every reload until Postgres refuses connections — hence the cached client.
//
// The cache is keyed on the generated client's class, not merely on "is there
// one". `npx prisma generate` rewrites that class while the dev server is still
// running, and the old instance only carries the models it was generated with:
// keeping it would make every model added since read as `undefined`, so the
// first page touching one dies with "Cannot read properties of undefined". A
// regenerated class is a different object, which retires the stale instance
// here instead of waiting for someone to restart the server.
const stale =
  globalForPrisma.prisma !== undefined && globalForPrisma.prismaCtor !== PrismaClient;

if (stale) void globalForPrisma.prisma?.$disconnect().catch(() => {});

export const prisma =
  stale || !globalForPrisma.prisma ? createClient() : globalForPrisma.prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaCtor = PrismaClient;
}
