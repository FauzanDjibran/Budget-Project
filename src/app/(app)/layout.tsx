import { AppShell } from "@/components/shell/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { prisma } from "@/lib/prisma";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const companies = await prisma.sysCompany.findMany({
    orderBy: { id: "asc" },
    select: { id: true, company_label: true, company_name: true },
  });

  // TODO: replace with the signed-in user once Auth.js is wired up.
  const user = await prisma.sysUser.findFirst({
    where: { email: "meehun@siba.app" },
    select: { name: true, initials: true },
  });

  return (
    <ToastProvider>
      <AppShell
        companies={companies.map((c) => ({
          id: c.id,
          label: c.company_label,
          name: c.company_name,
        }))}
        user={user ?? { name: "—", initials: "?" }}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
