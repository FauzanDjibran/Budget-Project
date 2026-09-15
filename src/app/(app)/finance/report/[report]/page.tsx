import { notFound } from "next/navigation";
import { CashBankBalanceReport } from "@/components/report/cash-bank-balance-report";
import { CashBankLedgerReport } from "@/components/report/cash-bank-ledger-report";
import { ReportParams } from "@/components/report/report-params";
import { ReportNeedsSubject, ReportView } from "@/components/report/report-view";
import { requirePermission } from "@/lib/siba/auth";
import {
  cashBankBalanceReport,
  cashBankLedgerReport,
  type PeriodRange,
} from "@/lib/siba/cash-bank";
import { reportBySlug, reportHref } from "@/lib/siba/reports";
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
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<{ cashBank?: string; from?: string; to?: string }>;
}) {
  const { report: slug } = await params;
  const report = reportBySlug(slug);
  if (!report) notFound();

  await requirePermission(report.permission, reportHref(slug));

  const query = await searchParams;
  const range = resolveRange(query.from, query.to);
  const cashBankId = positiveInt(query.cashBank);

  const resources = await cashBankOptions();
  const runAt = new Date().toISOString();

  const paramBar = (
    <ReportParams
      slug={slug}
      resources={resources}
      cashBankId={cashBankId}
      from={range.from}
      to={range.to}
      subjectRequired={report.subjectRequired}
      subjectLabel="Cash & Bank"
      allLabel={report.subjectRequired ? undefined : "Semua resource"}
    />
  );

  const period = `${formatDate(range.from)} – ${formatDate(range.to)}`;

  // --------------------------------------------------------------- ledger

  if (report.key === "cash_bank_ledger") {
    const data = cashBankId
      ? await cashBankLedgerReport(cashBankId, range)
      : null;

    return (
      <ReportView
        report={report}
        params={paramBar}
        runAt={runAt}
        criteria={
          data
            ? [
                {
                  label: "Resource",
                  value: data.resource.label,
                  hint: data.resource.name,
                },
                { label: "Company", value: data.resource.companyLabel },
                { label: "Currency", value: data.resource.currencyLabel },
                { label: "Periode", value: period },
                { label: "Jumlah mutasi", value: String(data.entries.length) },
              ]
            : [{ label: "Periode", value: period }]
        }
        footnote={
          <>
            Saldo awal adalah seluruh mutasi sebelum {formatDate(range.from)},
            bukan entri tersendiri — karena itu tidak muncul sebagai baris.
            Kolom Saldo menampilkan saldo tercatat pada setiap entri, dan Buku
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

  const data = await cashBankBalanceReport(range, cashBankId);

  return (
    <ReportView
      report={report}
      params={paramBar}
      runAt={runAt}
      criteria={[
        {
          label: "Resource",
          value: cashBankId
            ? resources.find((r) => r.id === cashBankId)?.label ?? "—"
            : "Semua resource",
        },
        { label: "Periode", value: period },
        { label: "Currency", value: `${data.groups.length} currency` },
        { label: "Jumlah resource", value: String(data.resources) },
      ]}
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

/**
 * The resources a report may be run for.
 *
 * Inactive ones stay selectable: a report about last quarter is exactly when a
 * resource that has since been deactivated still matters. The list marks them,
 * which is what `Combobox` does with `active: false` when the value is chosen.
 */
async function cashBankOptions() {
  const rows = await prisma.mCashBank.findMany({
    orderBy: [{ company_id: "asc" }, { cash_bank_label: "asc" }],
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
