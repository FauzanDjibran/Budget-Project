/**
 * The two failure modes kept apart, because they mean different things and the
 * application responds to them differently:
 *
 *   UNAUTHENTICATED — no valid session. The user is sent to the login page.
 *   UNAUTHORIZED    — a valid session without the required permission. The user
 *                     stays signed in and sees a refusal.
 *
 * Messages are deliberately generic: they name what was refused, never which
 * permission code, which record exists, or anything about the authorization
 * model's internals.
 */

export type DenialKind = "UNAUTHENTICATED" | "UNAUTHORIZED";

export const UNAUTHENTICATED_MESSAGE =
  "Sesi Anda sudah berakhir. Silakan masuk kembali.";

export const UNAUTHORIZED_MESSAGE =
  "Anda tidak memiliki akses untuk tindakan ini.";

export function denialMessage(kind: DenialKind): string {
  return kind === "UNAUTHENTICATED" ? UNAUTHENTICATED_MESSAGE : UNAUTHORIZED_MESSAGE;
}

/**
 * Thrown by the service layer when a caller lacks access. Server Actions catch
 * it and turn it into their normal `{ ok: false }` result; pages let it surface
 * as a refusal screen.
 */
export class AccessDeniedError extends Error {
  readonly kind: DenialKind;

  constructor(kind: DenialKind) {
    super(denialMessage(kind));
    this.name = "AccessDeniedError";
    this.kind = kind;
  }
}

export function isAccessDenied(error: unknown): error is AccessDeniedError {
  return error instanceof AccessDeniedError;
}
