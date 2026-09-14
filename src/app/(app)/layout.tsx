import { AppShell } from "@/components/shell/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/siba/auth";
import { visibleModules } from "@/lib/siba/nav";

/**
 * Every application route sits under this layout, and nothing renders until a
 * session is proven. The pages below add their own permission checks — this
 * only answers "is anyone signed in?".
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await requireAuth();

  const companies = await prisma.sysCompany.findMany({
    orderBy: { id: "asc" },
    select: { id: true, company_label: true, company_name: true },
  });

  return (
    <ToastProvider>
      <AppShell
        companies={companies.map((c) => ({
          id: c.id,
          label: c.company_label,
          name: c.company_name,
        }))}
        user={{
          name: actor.user.name,
          initials: actor.user.initials,
          email: actor.user.email,
          roles: actor.roles.map((r) => r.name),
        }}
        modules={visibleModules(actor.permissions)}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
