import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/siba/session";

/**
 * Optimistic route protection.
 *
 * Proxy runs before every route, including prefetches, so it only checks
 * whether a session cookie is present — no database lookup, no permission
 * evaluation. That makes it a redirect convenience, NOT a security boundary:
 * a forged cookie gets past this file and is then rejected by the real check.
 *
 * The enforcement lives in `src/lib/siba/auth.ts`, called by `(app)/layout.tsx`,
 * by every page, and by every Server Action. Deleting this file would cost
 * nothing but a tidy redirect.
 *
 * (`proxy.ts` is Next 16's name for what used to be `middleware.ts` — see
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.)
 */

/**
 * `/api/health` is here because whatever polls it — an uptime monitor, a
 * reverse proxy, a deploy script waiting for the new process — has no session
 * cookie, and a 302 to the login page reads as "alive" to most of them. The
 * route itself reports only up/down and never describes the system.
 */
const PUBLIC_PATHS = ["/login", "/api/health"];

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  // Bring the visitor back where they were aiming once they sign in.
  if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own assets and the favicon; auth checks belong on
  // every application route.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|jpeg|gif|webp|ico)$).*)"],
};
