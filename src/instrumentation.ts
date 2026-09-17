/**
 * Startup checks, run once before the server accepts a request.
 *
 * Next calls `register` when a server instance is initiated and waits for it,
 * so anything that stops the process here stops it before it can serve traffic.
 * That is the point: the failure this guards against is deploying code whose
 * schema has not been migrated, which otherwise surfaces as "Cannot read
 * properties of undefined" on whichever page a user happens to open first.
 *
 * In development it only warns — a developer with the database stopped should
 * still be able to start the app and read the message.
 *
 * The check itself sits in `instrumentation-node.ts` and is reached by dynamic
 * import: `register` runs in the Edge runtime too, and anything this file can
 * see is compiled for it.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runStartupCheck } = await import("./instrumentation-node");
  await runStartupCheck();
}
