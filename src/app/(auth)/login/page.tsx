import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { currentActor } from "@/lib/siba/auth";
import { landingHref } from "@/lib/siba/nav";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  // Someone already signed in has no business on the login screen.
  const actor = await currentActor();
  if (actor) redirect(safeNext(next) ?? landingHref(actor.permissions));

  return <LoginForm next={safeNext(next)} />;
}

/**
 * `next` comes from the URL, so it is attacker-controlled. Only same-site
 * absolute paths are honoured — anything else would turn the login screen into
 * an open redirect.
 */
function safeNext(next: string | undefined): string | undefined {
  if (!next) return undefined;
  if (!next.startsWith("/") || next.startsWith("//")) return undefined;
  return next;
}
