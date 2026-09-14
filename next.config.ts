import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
