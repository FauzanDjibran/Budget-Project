/**
 * Startup checks, run once before the server accepts a request.
 *
 * Next calls `register` when a server instance is initiated and waits for it,
 * so anything that throws here stops the process rather than letting it serve
 * traffic. That is the point: the failure this guards against is deploying code
 * whose schema has not been migrated, which otherwise surfaces as "Cannot read
 * properties of undefined" on whichever page a user happens to open first.
 *
 * In development it only warns — a developer with the database stopped should
 * still be able to start the app and read the message.
 */

export async function register() {
  // `register` also runs in the Edge runtime, which has no database client.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const production = process.env.NODE_ENV === "production";

  try {
    const { assertSchemaIsCurrent } = await import("./lib/siba/startup-check");
    const report = await assertSchemaIsCurrent();
    if (report.ok) {
      console.log(`[siba] schema check passed (${report.checked} tables)`);
      return;
    }
    fail(production, `[siba] ${report.problem}`);
  } catch (error) {
    fail(production, `[siba] startup check could not run: ${String(error)}`);
  }
}

/**
 * Refuse to run, loudly and terminally.
 *
 * Throwing is not enough. A `register` that throws leaves Next listening and
 * answering 500 on every request, which a process supervisor reads as "running"
 * — so systemd never restarts it and a deploy sits there serving errors.
 * Verified against this build: the failed process held its port for as long as
 * it was left alone. Exiting is the honest signal — the supervisor restarts it,
 * and a deploy's health check fails immediately instead of timing out.
 */
function fail(production: boolean, message: string): never | void {
  if (!production) {
    console.warn(`${message}\n[siba] continuing: NODE_ENV is not production.`);
    return;
  }
  console.error(message);
  process.exit(1);
}
