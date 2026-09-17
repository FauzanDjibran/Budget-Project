/**
 * The Node.js half of the startup check.
 *
 * It lives in its own module because `instrumentation.ts` is bundled for the
 * Edge runtime as well, and the build warns about every Node API it can see
 * there — `process.exit` included — however unreachable the guard makes it.
 * A dynamic import keeps this file out of that bundle entirely, which is the
 * shape Next's own instrumentation guide prescribes.
 */

export async function runStartupCheck() {
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
