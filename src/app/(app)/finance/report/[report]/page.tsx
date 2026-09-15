import { notFound } from "next/navigation";
import { CashBankBalanceReport } from "@/components/report/cash-bank-balance-report";
import { CashBankLedgerReport } from "@/components/report/cash-bank-ledger-report";
import {
  CompanyFilter,
  NoCompanyAccess,
} from "@/components/master/company-filter";
import { ReportParams } from "@/components/report/report-params";
import { SubjectParams } from "@/components/report/subject-params";
import { SubledgerReport } from "@/components/report/subledger-report";
import { ReportNeedsSubject, ReportView } from "@/components/report/report-view";
import { requirePermission } from "@/lib/siba/auth";
import {
  cashBankBalanceReport,
  cashBankLedgerReport,
} from "@/lib/siba/cash-bank";
import { companyScope } from "@/lib/siba/company-access";
import type { PeriodRange } from "@/lib/siba/period";
import { reportBySlug, reportHref } from "@/lib/siba/reports";
import { subledgerReport, subledgerSubjects } from "@/lib/siba/subledger";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Every Report View in the Finance module, driven by the catalogue.
 *
 * One route rather than one file per report, for the reason §12 gives for the
 * registry pages: the chrome, the permission check and the parameter parsing
 * are the same every time, and only the body differs. Adding a report is a
 * `reports.ts` entry plus a body component.
 *
 * **Parameters come from the query string**, so a report run is a URL: linkable,
 * bookmarkable, and back-button-able. The page reads them, resolves defaults,
 * and queries — no client-side fetching (CLAUDE.md §3).
 *
 * **Every report runs for one Company**, chosen here and carried in `?company=`.
 * A cash resource, a Partner and an account all belong to one, so a report over
 * both reads as duplicated rows — and the scope is also what stops a reader
 * without anak access seeing the anak's book, which is a permission the rest of
 * the application already enforces and a report must not be a way around.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<{
    company?: string;
    cashBank?: string;
    partners?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { report: slug } = await params;
  const report = reportBySlug(slug);
  if (!report) notFound();

  const actor = await requirePermission(report.permission, reportHref(slug));

  const query = await searchParams;
  const range = resolveRange(query.from, query.to);
  const cashBankId = positiveInt(query.cashBank);
  const scope = await companyScope(actor.permissions, query.company);
  const company = scope.selected;
  const runAt = new Date().toISOString();

  if (!company) {
    return (
      <ReportView report={report} filter={null} runAt={runAt}>
        <NoCompanyAccess what={report.name} />
      </ReportView>
    );
  }

  const companyIds = [company.id];

  // ------------------------------------------------------------ subledgers

  if (report.subledger) {
    return subledgerPage({
      report,
      slug,
      range,
      partnerIds: idList(query.partners),
      company,
      options: scope.options,
    });
  }

  const resources = await cashBankOptions(company.id);

  const filterBar = (
    <>
      <CompanyFilter options={scope.options} selectedId={company.id} />
      <ReportParams
        slug={slug}
        resources={resources}
        cashBankId={cashBankId}
        from={range.from}
        to={range.to}
        subjectRequired={report.subjectRequired}
        subjectLabel="Cash & Bank"
        allLabel={report.subjectRequired ? undefined : "Semua resource"}
        companyId={company.id}
      />
    </>
  );

  // --------------------------------------------------------------- ledger

  if (report.key === "cash_bank_ledger") {
    const data = cashBankId
      ? await cashBankLedgerReport(cashBankId, range, companyIds)
      : null;

    return (
      <ReportView
        report={report}
        filter={filterBar}
        runAt={runAt}
        footnote={
          <>
            Saldo awal adalah seluruh mutasi sebelum {formatDate(range.from)},
            bukan entri tersendiri — karena itu tidak muncul sebagai baris.
            Entri saldo awal dan penyesuaian ditandai pada kolom Keterangan; baris tanpa
            tanda adalah transaksi biasa. Kolom Saldo menampilkan saldo tercatat pada setiap entri, dan Buku
            Kas &amp; Bank bersifat append-only: koreksi dicatat sebagai entri
            baru, bukan dengan mengubah entri lama.
          </>
        }
      >
        {data ? (
          <CashBankLedgerReport report={data} />
        ) : (
          <ReportNeedsSubject
            icon="book"
            title="Pilih Cash & Bank terlebih dahulu"
            body="Buku kas/bank selalu milik satu resource. Pilih resource dan rentang tanggal di atas, lalu tekan Tampilkan."
          />
        )}
      </ReportView>
    );
  }

  // -------------------------------------------------------------- balance

  const data = await cashBankBalanceReport(range, companyIds, cashBankId);

  return (
    <ReportView
      report={report}
      filter={filterBar}
      runAt={runAt}
      footnote={
        <>
          Setiap currency direkap terpisah dan tidak pernah dijumlahkan menjadi
          satu angka, karena belum ada sumber kurs di sistem ini. Resource
          non-aktif tetap muncul bila punya saldo awal atau mutasi pada periode
          ini — tanpa itu laporan tidak akan cocok dengan buku yang dirangkumnya.
          Klik nama resource untuk membuka Buku Kas &amp; Bank pada periode yang
          sama.
        </>
      }
    >
      <CashBankBalanceReport report={data} />
    </ReportView>
  );
}

/**
 * One subject book over a period.
 *
 * Its own function rather than another branch in the body above, because a
 * subledger asks a different question of the request: its subject is a set of
 * Partners rather than one resource, and it is Company-scoped — a Partner
 * belongs to a Company, so a user who may not see the anak must not read the
 * anak's Hutang either. The rest of the Report View convention is unchanged:
 * parameters in the URL, filter in the sticky header, read-only output.
 */
async function subledgerPage({
  report,
  slug,
  range,
  partnerIds,
  company,
  options,
}: {
  report: NonNullable<ReturnType<typeof reportBySlug>>;
  slug: string;
  range: PeriodRange;
  partnerIds: number[];
  company: { id: number; label: string; name: string };
  options: { id: number; label: string; name: string }[];
}) {
  const runAt = new Date().toISOString();
  const companyIds = [company.id];

  const [subjects, data] = await Promise.all([
    subledgerSubjects(report.subledger!, companyIds),
    subledgerReport(report.subledger!, range, { partnerIds, companyIds }),
  ]);
  if (!data) notFound();

  return (
    <ReportView
      report={report}
      filter={
        <>
          <CompanyFilter options={options} selectedId={company.id} />
          <SubjectParams
            slug={slug}
            subjects={subjects}
            selectedIds={partnerIds}
            from={range.from}
            to={range.to}
            subjectRequired={report.subjectRequired}
            label="Partner"
            param="partners"
            addPlaceholder="Tambah Partner…"
            allPlaceholder="Semua Partner yang bergerak"
            missingHint="Pilih minimal satu Partner terlebih dahulu."
            companyId={company.id}
          />
        </>
      }
      runAt={runAt}
      footnote={
        <>
          Saldo awal adalah seluruh mutasi sebelum {formatDate(range.from)},
          bukan entri tersendiri — karena itu tidak muncul sebagai baris. Kolom
          Bertambah dan Berkurang mengikuti arah buku ini, bukan arah uang:{" "}
          {data.book.closingLabel.toLowerCase()} bertambah saat{" "}
          {data.book.raises === "In" ? "uang masuk" : "uang keluar"}. Buku
          pembantu ditulis langsung dari Cash Bank Transaction saat diposting,
          terpisah dari Journal, dan bersifat append-only: koreksi dicatat
          sebagai entri baru, bukan dengan mengubah entri lama.
        </>
      }
    >
      <SubledgerReport report={data} />
    </ReportView>
  );
}

/**
 * The period a report runs for.
 *
 * Defaults to the current month to date: predictable, needs no Fiscal Year to
 * exist, and consistent with the rule that a date field starts on today (§10).
 * A range whose end precedes its start is swapped rather than refused — the
 * parameter bar already blocks it, and a direct URL should still answer.
 */
function resolveRange(from?: string, to?: string): PeriodRange {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
  );

  const start = isDate(from) ? from : iso(monthStart);
  const end = isDate(to) ? to : iso(today);
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

function isDate(value: string | undefined): value is string {
  return Boolean(
    value &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

function positiveInt(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** `partners=3,17,42` — a set of subjects, in one linkable parameter. */
function idList(value: string | undefined): number[] {
  if (!value) return [];
  const ids = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)];
}

/**
 * The resources a report may be run for.
 *
 * Inactive ones stay selectable: a report about last quarter is exactly when a
 * resource that has since been deactivated still matters. The list marks them,
 * which is what `Combobox` does with `active: false` when the value is chosen.
 */
async function cashBankOptions(companyId: number) {
  const rows = await prisma.mCashBank.findMany({
    where: { company_id: companyId },
    orderBy: [{ cash_bank_label: "asc" }],
    select: {
      id: true,
      cash_bank_label: true,
      cash_bank_name: true,
      status: true,
      currency: { select: { currency_label: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.cash_bank_label,
    name:
      `${r.cash_bank_name} · ${r.currency.currency_label}` +
      (r.status === "Active" ? "" : " · non-aktif"),
    // Deliberately always true: a report must be runnable for a resource that
    // is no longer active, unlike a new-transaction picker, which hides them.
    // The name says so instead of the option disappearing.
    active: true,
  }));
}
