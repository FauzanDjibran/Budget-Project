import { notFound } from "next/navigation";
import { SubjectParams } from "@/components/report/subject-params";
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
import type { PeriodRange } from "@/lib/siba/period";
import { reportBySlug, reportHref } from "@/lib/siba/reports";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { formatDate } from "@/lib/format";
import type { OpeningProvenance } from "@/lib/siba/ledger";
import { FiscalPeriodParams } from "@/components/report/fiscal-period-params";
import { ProfitLossReport } from "@/components/report/profit-loss-report";
import { Icon } from "@/components/icon";
import {
  reportableFiscalYears,
  unclosedPriorYear,
  type ReportableFiscalYear,
} from "@/lib/siba/fiscal";
import { profitLossReport, resolveColumn } from "@/lib/siba/statements";
import type { StatementMode } from "@/lib/siba/statement-layout";
import type { ReportDef } from "@/lib/siba/reports";

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
    year?: string;
    period?: string;
    mode?: string;
    cmpYear?: string;
    cmpPeriod?: string;
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
        filter={null}
        runAt={new Date().toISOString()}
      >
        <NoCompanyAccess what={report.name} />
      </ReportView>
    );
  }

  if (report.params === "fiscal-period") {
    return statementPage(report, slug, company.id, scope.options, query);
  }

  const companyIds = [company.id];
  const range = resolveRange(query.from, query.to);
  const accountIds = parseIds(query.accounts);

  const options = await ledgerAccountOptions(company.id);
  const runAt = new Date().toISOString();

  const filterBar = (
    <>
      <CompanyFilter options={scope.options} selectedId={company.id} />
      <SubjectParams
        slug={slug}
        subjects={options}
        selectedIds={accountIds}
        from={range.from}
        to={range.to}
        subjectRequired={report.subjectRequired}
        label="Account"
        param="accounts"
        addPlaceholder="Tambah account…"
        allPlaceholder="Semua account yang bergerak"
        missingHint="Pilih minimal satu account terlebih dahulu."
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
        filter={filterBar}
        runAt={runAt}
        footnote={
          <>
            Seluruh angka dalam mata uang dasar ({BASE_CURRENCY_LABEL}), dan saldo
            bergerak mengikuti normal balance account — account Debit naik di sisi
            debit, account Kredit di sisi kredit{openingSource(data?.openingFrom)}.
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

  return (
    <ReportView
      report={report}
      filter={filterBar}
      runAt={runAt}
      footnote={
        <>
          Seluruh angka dalam mata uang dasar ({BASE_CURRENCY_LABEL}), dan total
          mutasi debit wajib sama dengan total kredit — selisih di sini berarti
          ada masalah sistem, bukan kesalahan input
          {openingSource(data.openingFrom)}.
        </>
      }
    >
      <TrialBalanceReport report={data} companyId={company.id} />
    </ReportView>
  );
}

/**
 * Where the saldo awal came from, as one clause on the report's own footnote.
 *
 * The figure is identical whether it was summed from the whole history or read
 * off a snapshot — that equivalence is the property the change rests on — so
 * this is provenance rather than a caveat. It earns its place because a reader
 * checking an opening balance can now open the document it came from, instead
 * of re-adding years of entries the page does not show.
 *
 * A clause rather than a second sentence: a report footnote is one sentence
 * (CLAUDE.md §12), and this does not change what the sentence is about.
 */
function openingSource(from: OpeningProvenance | null | undefined) {
  if (!from) return null;
  return `; saldo awal diambil dari Opening Balance ${from.openingNo} per ${formatDate(from.date)}`;
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

// ------------------------------------------------------- financial statements

/**
 * The `fiscal-period` reports: a fiscal year and a period, a mode, and an
 * optional second year and period to compare against.
 *
 * With nothing chosen the report opens on the period containing today, in the
 * Open year that holds it — the statement a reader most often wants — and
 * falls back to the newest period that exists.
 */
async function statementPage(
  report: ReportDef,
  slug: string,
  companyId: number,
  companyOptions: Parameters<typeof CompanyFilter>[0]["options"],
  query: {
    year?: string;
    period?: string;
    mode?: string;
    cmpYear?: string;
    cmpPeriod?: string;
  }
) {
  const runAt = new Date().toISOString();
  const years = await reportableFiscalYears();

  if (!years.length) {
    return (
      <ReportView report={report} filter={<CompanyFilter options={companyOptions} selectedId={companyId} />} runAt={runAt}>
        <ReportNeedsSubject
          icon="cal"
          title="Belum ada tahun buku aktif"
          body="Laporan keuangan dibaca per periode tahun buku. Aktifkan Fiscal Year terlebih dahulu — periode bulanannya dibuat saat itu."
        />
      </ReportView>
    );
  }

  const mode: StatementMode = query.mode === "mtd" ? "mtd" : "ytd";
  const fallback = defaultPeriod(years);
  const main =
    resolveColumn(years, toId(query.year), toId(query.period), mode) ??
    resolveColumn(years, fallback.yearId, fallback.periodId, mode)!;
  const compare = resolveColumn(years, toId(query.cmpYear), toId(query.cmpPeriod), mode);
  const columns = compare ? [main, compare] : [main];

  const data = await profitLossReport(companyId, columns);

  // A previous year this Company has not closed yet. The figures are right
  // either way — a Laba Rugi is a range sum — but the books are still running
  // as an extension of that year, and the report says so rather than leaving
  // a reader to find out on the Neraca.
  const carried = await unclosedPriorYear(companyId);
  const mainYear = years.find((y) => y.id === main.yearId)!;
  const carriedYear = carried ? years.find((y) => y.id === carried.id) : null;
  const carrying =
    carriedYear && carriedYear.startDate < mainYear.startDate ? carriedYear : null;

  const filter = (
    <>
      <CompanyFilter options={companyOptions} selectedId={companyId} />
      <FiscalPeriodParams
        slug={slug}
        companyId={companyId}
        years={years.map((y) => ({
          id: y.id,
          // The bar already says Tahun Buku beside the picker; the label alone reads.
          name: y.label,
          periods: y.periods.map((p) => ({ id: p.id, name: p.name })),
        }))}
        main={{ yearId: main.yearId, periodId: main.periodId }}
        compare={compare ? { yearId: compare.yearId, periodId: compare.periodId } : null}
        mode={mode}
        showMode
      />
    </>
  );

  return (
    <ReportView
      report={report}
      filter={filter}
      runAt={runAt}
      footnote={
        <>
          Seluruh angka dalam mata uang dasar ({BASE_CURRENCY_LABEL}), dijumlah dari
          journal yang diposting pada rentang tiap kolom — tidak termasuk journal
          penutupan tahun buku kolom itu sendiri.
        </>
      }
    >
      {carrying && (
        <div className="nbox warn slim" style={{ margin: "0 0 12px" }}>
          <Icon name="warn" size={14} />
          <div>
            <b>{carrying.name} belum ditutup untuk Company ini.</b>
            <p>
              Angka Laba Rugi tetap benar karena setiap kolom hanya menjumlah
              periodenya sendiri, tetapi hasil {carrying.name} belum dipindahkan ke
              Laba/Rugi Tahun Sebelumnya.
            </p>
          </div>
        </div>
      )}
      {data.unplaced.length > 0 && (
        <div className="nbox bad slim" style={{ margin: "0 0 12px" }}>
          <Icon name="warn" size={14} />
          <div>
            <b>Ada account yang bergerak tanpa tingkat Laba Rugi.</b>
            <p>
              Kategori account berikut tidak menyebut tingkat Laba Rugi, sehingga
              nilainya tidak masuk ke subtotal manapun: {data.unplaced.join(", ")}.
            </p>
          </div>
        </div>
      )}
      <ProfitLossReport columns={data.columns} rows={data.rows} companyId={companyId} />
    </ReportView>
  );
}

/** The Open year holding today, and its period holding today; else the newest. */
function defaultPeriod(years: ReportableFiscalYear[]): { yearId: number; periodId: number | null } {
  const today = new Date().toISOString().slice(0, 10);
  const year =
    years.find((y) => y.status === "Open" && y.startDate <= today && today <= y.endDate) ??
    years[0];
  const period =
    year.periods.find((p) => p.startDate <= today && today <= p.endDate) ??
    year.periods[year.periods.length - 1];
  return { yearId: year.id, periodId: period?.id ?? null };
}

function toId(raw?: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
