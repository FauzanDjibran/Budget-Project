import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/siba/auth";
import { landingHref } from "@/lib/siba/nav";

export const dynamic = "force-dynamic";

/**
 * Lands the signed-in user on the first thing they are allowed to see, rather
 * than assuming everyone can reach the dashboard.
 */
export default async function RootPage() {
  const actor = await requireAuth();
  redirect(landingHref(actor.permissions));
}
