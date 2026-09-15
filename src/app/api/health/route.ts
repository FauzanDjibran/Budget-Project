import { prisma } from "@/lib/prisma";

/**
 * Liveness and readiness, for whatever is watching the process.
 *
 * The one Route Handler in the application, and the one route reachable without
 * a session besides `/login` — an uptime monitor or a reverse proxy has no
 * cookie to present. `src/proxy.ts` exempts it for that reason.
 *
 * It says only whether the process is up and whether the database answers.
 * Deliberately no version, no schema detail, no error text: a public endpoint
 * that describes the inside of the system is a reconnaissance tool, and the
 * operator can read the real reason in the server log.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      { status: "ok", database: "up", ms: Date.now() - startedAt },
      { status: 200, headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    console.error("[siba] health check: database unreachable", error);
    return Response.json(
      { status: "degraded", database: "down" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
