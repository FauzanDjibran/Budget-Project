import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Emits `.next/standalone/server.js` — the app plus only the `node_modules`
   * it actually reaches, so a deployment ships a few hundred files instead of
   * the whole dependency tree and needs no `npm install` on the server.
   *
   * The minimal server does NOT copy `public` or `.next/static`; Next expects a
   * CDN to serve those. There is no CDN here, so `npm run build:standalone`
   * copies them in afterwards and `server.js` then serves them itself.
   */
  output: "standalone",

  experimental: {
    /**
     * Enables `forbidden()` and the `forbidden.tsx` convention, so an
     * authorization refusal renders its own screen with a real 403 rather than
     * surfacing as a generic server error. See
     * `src/lib/siba/auth.ts` and `src/app/forbidden.tsx`.
     */
    authInterrupts: true,
  },
};

export default nextConfig;
