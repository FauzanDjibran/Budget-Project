"use client";

import { AccessDenied } from "@/components/auth/access-denied";

/**
 * Generic error boundary for the application routes.
 *
 * Authorization refusals do NOT arrive here — `requirePermission` calls
 * `forbidden()`, which renders `app/forbidden.tsx` with a 403. This exists so
 * an unrelated failure shows something in the design system's language instead
 * of a bare stack trace, and it deliberately says nothing about the cause.
 */
export default function AppError() {
  return (
    <AccessDenied
      title="Terjadi kesalahan"
      body="Halaman ini tidak dapat dimuat. Coba muat ulang; jika berlanjut, hubungi administrator."
      backHref="/"
    />
  );
}
