import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Finishes the standalone build.
 *
 * `output: "standalone"` emits `.next/standalone/server.js` with only the
 * `node_modules` the app actually reaches, but deliberately leaves out `public`
 * and `.next/static` — Next assumes a CDN serves them. There is no CDN here, so
 * they are copied in and `server.js` serves them itself.
 *
 * `prisma/` is copied too: `prisma migrate deploy` on the server needs the
 * schema and the migration folders, and the startup check reads the schema to
 * work out which tables should exist.
 *
 * Written as a script rather than a shell one-liner because `cp -r` is not
 * available in every shell this repository is used from (CLAUDE.md §6).
 */

const root = process.cwd();
const out = join(root, ".next", "standalone");

if (!existsSync(out)) {
  console.error(
    "No .next/standalone — run `next build` first, with `output: \"standalone\"` set."
  );
  process.exit(1);
}

const copies: [from: string, to: string][] = [
  [join(root, "public"), join(out, "public")],
  [join(root, ".next", "static"), join(out, ".next", "static")],
  [join(root, "prisma"), join(out, "prisma")],
];

for (const [from, to] of copies) {
  if (!existsSync(from)) {
    console.warn(`skipped (not present): ${from.slice(root.length + 1)}`);
    continue;
  }
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`copied ${from.slice(root.length + 1)} -> ${to.slice(root.length + 1)}`);
}

console.log("\nStandalone bundle ready. Run it with:\n  node .next/standalone/server.js");
