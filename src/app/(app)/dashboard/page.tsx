import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";
import { prisma } from "@/lib/prisma";
import { actorCan } from "@/lib/siba/access";
import { requirePermission } from "@/lib/siba/auth";
import { companyStructure } from "@/lib/siba/records";
import { userEmails } from "@/lib/siba/users";
import { formatTimestamp } from "@/lib/format";

export const dynamic = "force-dynamic";

const ACTION_CLASS: Record<string, string> = {
  TAMBAH: "s-ok",
  UPDATE: "s-warn",
  HAPUS: "s-bad",
};

type Attention = { href: string; title: string; detail: string };

type Kpi = {
  href: string;
  label: string;
  value: number;
  detail: string;
  bg: string;
  fg: string;
  icon: IconName;
  /** The permission that governs the page this tile links to. */
  permission: string;
};

type SpreadColumn = {
  label: string;
  permission: string;
  count: (companyId: number) => number;
};

export default async function DashboardPage() {
  const actor = await requirePermission("MENU_DASHBOARD_ACCESS", "/dashboard");

  // Reaching the dashboard is not permission to read what it summarises. Every
  // tile, follow-up and column below is filtered by the permission that governs
  // the page it points at, so the dashboard never becomes a way to see totals
  // for data the user cannot open.
  const can = (code: string) => actorCan(actor, code);

  const [
    companies,
    partners,
    cashBanks,
    accounts,
    mappings,
    budgets,
    budgetCategories,
    fiscalPeriods,
    recentAudit,
    structure,
  ] = await Promise.all([
    prisma.sysCompany.findMany({ orderBy: { id: "asc" } }),
    prisma.mPartner.findMany({ select: { id: true, company_id: true } }),
    prisma.mCashBank.findMany({
      select: { id: true, company_id: true, cash_bank_name: true, account: { select: { company_id: true } } },
    }),
    prisma.accAccount.findMany({ select: { id: true, company_id: true } }),
    prisma.accBudgetCategoryAccount.findMany({
      select: { company_id: true, budget_category_id: true },
    }),
    prisma.budBudget.count(),
    prisma.sysBudgetCategory.findMany({ select: { id: true, category_label: true } }),
    prisma.accFiscalPeriod.count(),
    prisma.auditLog.findMany({ orderBy: { at: "desc" }, take: 6 }),
    companyStructure(),
  ]);

  // The activity list used to print a fixed address; it now resolves the actual
  // author of each entry.
  const authors = await userEmails(recentAudit.map((l) => l.by));

  const countIn = <T extends { company_id: number }>(rows: T[], companyId: number) =>
    rows.filter((r) => r.company_id === companyId).length;

  const allKpis: Kpi[] = [
    { href: "/master/company", label: "Company", value: companies.length, detail: "Entitas akuntansi", bg: "var(--brand-50)", fg: "var(--brand)", icon: "build", permission: "COMPANY_VIEW" },
    { href: "/master/partner", label: "Partner", value: partners.length, detail: "Subjek bisnis", bg: "var(--vio-bg)", fg: "var(--vio)", icon: "users", permission: "PARTNER_VIEW" },
    { href: "/master/cash-bank", label: "Cash & Bank", value: cashBanks.length, detail: "Resource kas dan bank", bg: "var(--ok-bg)", fg: "var(--ok)", icon: "wallet", permission: "CASH_BANK_VIEW" },
    { href: "/accounting/account", label: "Account", value: accounts.length, detail: "Seluruh Company", bg: "var(--info-bg)", fg: "var(--info)", icon: "book", permission: "ACCOUNT_VIEW" },
    { href: "/accounting/budget-category-account", label: "Mapping", value: mappings.length, detail: "Budget Category ke Account", bg: "var(--accent-50)", fg: "#8A6D08", icon: "link", permission: "MAPPING_VIEW" },
    { href: "/budget/budget", label: "Budget", value: budgets, detail: "Seluruh periode", bg: "var(--accent-50)", fg: "#8A6D08", icon: "clip", permission: "BUDGET_VIEW" },
  ];
  const kpis = allKpis.filter((k) => can(k.permission));

  // Follow-ups, in the order a new installation has to work through them: a
  // chart of accounts, then the mapping that points budget categories at it,
  // then a fiscal calendar, then somewhere for the money to sit. Referential
  // problems Postgres already makes impossible are deliberately not checked.
  const attention: Attention[] = [];

  // The two-company structure is foundational: exactly one induk and one anak.
  // Nothing in the app can create or edit a Company, so a mismatch here means
  // the database was changed outside the seed.
  if (!structure.ok && can("COMPANY_VIEW")) {
    attention.push({
      href: "/master/company",
      title: "Struktur Company tidak sesuai",
      detail:
        `Ditemukan ${structure.total} Company (${structure.parents} induk, ${structure.children} anak). ` +
        "Sistem mengharuskan tepat satu induk dan satu anak — perbaiki langsung pada database.",
    });
  }

  // A brand-new installation has system data and nothing else. These say what
  // to do next, in the order the modules depend on each other, rather than
  // leaving someone to discover an empty picker on a form.
  if (!accounts.length && can("ACCOUNT_VIEW")) {
    attention.push({
      href: "/accounting/account",
      title: "Bagan akun belum dibuat",
      detail:
        "Account adalah dasar seluruh modul: Cash & Bank, mapping Budget Category, " +
        "dan nantinya Journal. Susun bagan akun tiap Company terlebih dahulu.",
    });
  }

  if (!fiscalPeriods && can("FISCAL_YEAR_VIEW")) {
    attention.push({
      href: "/accounting/fiscal-year",
      title: "Belum ada Fiscal Period",
      detail:
        "Budget Month mengikuti Fiscal Period. Buat Fiscal Year lalu ubah statusnya " +
        "menjadi Open — 12 periode bulanan akan dibuat otomatis.",
    });
  }

  const crossCompany = cashBanks.filter(
    (cb) => cb.account && cb.account.company_id !== cb.company_id
  );
  if (crossCompany.length && can("CASH_BANK_VIEW")) {
    attention.push({
      href: "/master/cash-bank",
      title: `${crossCompany.length} Cash & Bank memakai Account milik Company lain`,
      detail: "Account harus berada pada Company yang sama dengan resource-nya.",
    });
  }

  // Only worth raising once a chart of accounts exists — before that, the
  // missing accounts are the thing to fix and this would just repeat it.
  const unmapped: string[] = [];
  if (accounts.length) {
    for (const c of companies) {
      for (const bc of budgetCategories) {
        const has = mappings.some(
          (m) => m.company_id === c.id && m.budget_category_id === bc.id
        );
        if (!has) unmapped.push(`${c.company_label} · ${bc.category_label}`);
      }
    }
  }
  if (unmapped.length && can("MAPPING_VIEW")) {
    attention.push({
      href: "/accounting/budget-category-account",
      title: `${unmapped.length} Budget Category belum dipetakan ke Account`,
      detail:
        "Belum dipetakan: " +
        unmapped.slice(0, 4).join(", ") +
        (unmapped.length > 4 ? `, dan ${unmapped.length - 4} lainnya.` : "."),
    });
  }

  const withoutCashBank = companies.filter(
    (c) => !cashBanks.some((cb) => cb.company_id === c.id)
  );
  if (withoutCashBank.length && can("CASH_BANK_VIEW")) {
    attention.push({
      href: "/master/cash-bank",
      title: `${withoutCashBank.map((c) => c.company_name).join(", ")} belum memiliki Cash & Bank`,
      detail:
        "Company tanpa resource kas akan bergantung pada Company induk untuk setiap realisasi.",
    });
  }

  // Same rule for the per-company spread: a column appears only if its page does.
  const allSpread: SpreadColumn[] = [
    { label: "Partner", permission: "PARTNER_VIEW", count: (id) => countIn(partners, id) },
    { label: "Cash & Bank", permission: "CASH_BANK_VIEW", count: (id) => countIn(cashBanks, id) },
    { label: "Account", permission: "ACCOUNT_VIEW", count: (id) => countIn(accounts, id) },
    { label: "Mapping", permission: "MAPPING_VIEW", count: (id) => countIn(mappings, id) },
  ];
  const spread = allSpread.filter((c) => can(c.permission));

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span className="cur">Dashboard</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="grid" size={17} />
            </span>
            Master Data
          </h1>
        </div>
        <p className="ph-sub">
          Ringkasan referensi yang dipakai seluruh modul, beserta hal yang perlu
          ditindaklanjuti sebelum transaksi dijalankan.
        </p>
      </div>

      <div className="kpis">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="kpi" style={{ display: "block", textDecoration: "none" }}>
            <div className="h">
              <span className="i" style={{ background: k.bg, color: k.fg }}>
                <Icon name={k.icon} size={14} />
              </span>
              <span className="l">{k.label}</span>
            </div>
            <div className="v">{k.value}</div>
            <div className="d">{k.detail}</div>
          </Link>
        ))}
      </div>

      <div className="two">
        <div className="card">
          <div className="card-h">
            <span
              className="ci"
              style={{
                background: attention.length ? "var(--warn-bg)" : "var(--ok-bg)",
                color: attention.length ? "var(--warn)" : "var(--ok)",
              }}
            >
              <Icon name={attention.length ? "warn" : "check"} size={15} />
            </span>
            <div className="ct">
              <h3>Perlu Perhatian</h3>
              <p>
                {attention.length
                  ? `${attention.length} hal yang sebaiknya diselesaikan`
                  : "Tidak ada yang perlu ditindaklanjuti"}
              </p>
            </div>
          </div>

          {attention.length ? (
            attention.map((a) => (
              <Link key={a.title} href={a.href} className="att" style={{ textDecoration: "none" }}>
                <span className="i" style={{ background: "var(--warn-bg)", color: "var(--warn)" }}>
                  <Icon name="warn" size={14} />
                </span>
                <span className="b">
                  <b>{a.title}</b>
                  <span>{a.detail}</span>
                </span>
              </Link>
            ))
          ) : (
            <div className="empty sm">
              <div className="ic" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>
                <Icon name="check" size={20} />
              </div>
              <h4>Semua konsisten</h4>
              <p>Relasi antar master lengkap dan tidak ada nilai yang menggantung.</p>
            </div>
          )}
        </div>

        {spread.length > 0 && (
          <div className="card">
            <div className="card-h">
              <span className="ci">
                <Icon name="build" size={15} />
              </span>
              <div className="ct">
                <h3>Sebaran per Company</h3>
                <p>Master yang company-scoped</p>
              </div>
            </div>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Company</th>
                    {spread.map((col) => (
                      <th className="num" key={col.label}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <span className="idc">
                          <span className="lab">{c.company_label}</span>
                          <span className="nm">{c.company_name}</span>
                        </span>
                      </td>
                      {spread.map((col) => (
                        <td className="num" key={col.label}>
                          {col.count(c.id)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="hist" size={15} />
          </span>
          <div className="ct">
            <h3>Aktivitas Terakhir</h3>
            <p>Log audit jejak aktivitas perubahan data</p>
          </div>
        </div>

        {recentAudit.length ? (
          <div className="alog">
            {recentAudit.map((l) => (
              <div className="ae" key={l.id}>
                <span className="aav">
                  <Icon name="user" size={14} />
                </span>
                <div className="ab">
                  <div className="amail">{authors[l.by] ?? "—"}</div>
                  <div className="atime">{formatTimestamp(l.at)}</div>
                  <div className="aact">
                    <span className="adot" />
                    <span className="aent">{l.entity_key}</span>
                    <span className={`bdg ${ACTION_CLASS[l.action] ?? "s-mute"}`}>
                      {l.action}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty sm">
            <div className="ic">
              <Icon name="hist" size={20} />
            </div>
            <h4>Belum ada aktivitas</h4>
            <p>Perubahan pada data master akan tercatat di sini.</p>
          </div>
        )}
      </div>
    </>
  );
}
