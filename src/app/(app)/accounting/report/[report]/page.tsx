import { notFound } from "next/navigation";
import { AccountParams } from "@/components/report/account-params";
import { GeneralLedgerReport } from "@/components/report/general-ledger-report";
import { TrialBalanceReport } from "@/components/report/trial-balance-report";
import { ReportNeedsSubject, ReportView } from "@/components/report/report-view";
import { requirePermission } from "@/lib/siba/auth";
import { CompanyFilter, NoCompanyAccess } from "@/components/master/company-filter";
import { companyScope } from "@/lib/siba/company-access";
import {
  generalLedgerReport,
  ledgerAccountOptions,
  trialBalanceReport,
} from "@/lib/siba/ledger";
import type { PeriodRange } from "@/lib/siba/cash-bank";
import { reportBySlug, reportHref } from "@/lib/siba/reports";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The Accounting module's Report Views — General Ledger and Trial Balance.
 *
 * The same shape as the Finance report route (§12): the catalogue resolves the
 * report, the route checks its permission and parses its parameters, the chrome
 * is shared, and only the body differs. This one serves the `account-period`
 * parameter set, whose subject is **several** accounts rather than one.
 *
 * Both reports read journal lines, and they are the only things that do — the
 * operational books are written alongside the journal, never from it.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<{
    company?: string;
    accounts?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { report: slug } = await params;
  const report = reportBySlug(slug);
  if (!report || report.module !== "accounting") notFound();

  const actor = await requirePermission(report.permission, reportHref(slug));

  const query = await searchParams;
  // A chart of accounts belongs to one Company, so a ledger does too: each
  // numbers its own chart, and a picker offering both would list the induk's
  // 1.1.1.1 beside the anak's as if they were duplicates (CLAUDE.md §12).
  const scope = await companyScope(actor.permissions, query.company);
  const company = scope.selected;

  if (!company) {
    return (
      <ReportView
        report={report}
        params={null}
        runAt={new Date().toISOString()}
        criteria={[]}
      >
        <NoCompanyAccess what={report.name} />
      </ReportView>
    );
  }

  const companyIds = [company.id];
  const range = resolveRange(query.from, query.to);
  const accountIds = parseIds(query.accounts);

  const options = await ledgerAccountOptions(company.id);
  const runAt = new Date().toISOString();
  const period = `${formatDate(range.from)} – ${formatDate(range.to)}`;

  const paramBar = (
    <>
      <CompanyFilter options={scope.options} selectedId={company.id} />
      <AccountParams
        slug={slug}
        accounts={options}
        selectedIds={accountIds}
        from={range.from}
        to={range.to}
        subjectRequired={report.subjectRequired}
        companyId={company.id}
      />
    </>
  );

  // ------------------------------------------------------- general ledger

  if (report.key === "general_ledger") {
    const data = accountIds.length
      ? await generalLedgerReport(accountIds, range, companyIds)
      : null;

    return (
      <ReportView
        report={report}
        params={paramBar}
        runAt={runAt}
        criteria={
          data
            ? [
                { label: "Company", value: company.label },
                { label: "Account", value: `${data.accounts.length} account` },
                { label: "Periode", value: period },
                {
                  label: "Jumlah mutasi",
                  value: String(
                    data.accounts.reduce((t, a) => t + a.entries.length, 0)
                  ),
                },
              ]
            : [
                { label: "Company", value: company.label },
                { label: "Periode", value: period },
              ]
        }
        footnote={
          <>
            Setiap account memiliki tabelnya sendiri dan tidak pernah
            dijumlahkan dengan account lain — penjumlahan itu adalah tugas Trial
            Balance. Saldo bergerak mengikuti normal balance account: account
            Debit naik di sisi debit, account Kredit naik di sisi kredit. Saldo
            awal adalah seluruh mutasi sebelum {formatDate(range.from)} dan
            tidak muncul sebagai baris. Journal bersifat append-only: koreksi
            adalah journal baru, bukan perubahan journal lama.
          </>
        }
      >
        {data ? (
          <GeneralLedgerReport report={data} />
        ) : (
          <ReportNeedsSubject
            icon="tree"
            title="Pilih account terlebih dahulu"
            body="General Ledger selalu milik sebuah account. Pilih satu account atau lebih beserta rentang tanggal di atas, lalu tekan Tampilkan."
          />
        )}
      </ReportView>
    );
  }

  // --------------------------------------------------------- trial balance

  const data = await trialBalanceReport(range, companyIds);
  const accounts = data.groups.reduce((t, g) => t + g.rows.length, 0);

  return (
    <ReportView
      report={report}
      params={paramBar}
      runAt={runAt}
      criteria={[
        { label: "Company", value: company.label },
        { label: "Periode", value: period },
        { label: "Currency", value: `${data.groups.length} currency` },
        { label: "Jumlah account", value: String(accounts) },
        {
          label: "Keseimbangan",
          value: data.groups.every((g) => g.balanced)
            ? "Debit = Kredit"
            : "Tidak seimbang",
        },
      ]}
      footnote={
        <>
          Setiap currency direkap terpisah dan tidak pernah dijumlahkan menjadi
          satu angka, karena belum ada sumber kurs di sistem ini. Total mutasi
          debit dan kredit wajib sama: setiap journal ditolak bila kedua sisinya
          berbeda, sehingga selisih di sini berarti ada masalah sistem, bukan
          kesalahan input. Account yang tidak memiliki saldo awal maupun mutasi
          tidak ditampilkan. Klik nomor account untuk membuka General Ledger-nya
          pada periode yang sama.
        </>
      }
    >
      <TrialBalanceReport report={data} />
    </ReportView>
  );
}

/** Defaults to the current month to date, like every other Report View. */
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

/**
 * `accounts=3,17,42` — the subject of an `account-period` report.
 *
 * Duplicates are dropped and anything unparseable is ignored rather than
 * refused: a hand-edited URL should still answer with the accounts it does
 * name. Whether the reader may see them is decided by the query, which is
 * limited to the Companies their permissions open.
 */
function parseIds(raw?: string): number[] {
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(",")) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}
