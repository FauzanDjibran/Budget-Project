import { notFound } from "next/navigation";
import { SubjectParams } from "@/components/report/subject-params";
import { GeneralLedgerReport } from "@/components/report/general-ledger-report";
import { TrialBalanceReport } from "@/components/report/trial-balance-report";
import { ReportNeedsSubject, ReportView } from "@/components/report/report-view";
import { requirePermission } from "@/lib/siba/auth";
import { CompanyFilter, NoCompanyAccess } from "@/components/master/company-filter";
import { ReportCompany } from "@/components/report/report-run";
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
import { StatementReport } from "@/components/report/statement-report";
import { StatementTitle } from "@/components/report/statement-title";
import { STATEMENT_MODES } from "@/lib/siba/statement-layout";
import Link from "next/link";
import { Icon } from "@/components/icon";
import {
  reportableFiscalYears,
  unclosedPriorYear,
  type ReportableFiscalYear,
} from "@/lib/siba/fiscal";
import {
  balanceSheetReport,
  profitLossReport,
  resolveColumn,
  type StatementColumn,
} from "@/lib/siba/statements";
import { formatMoney } from "@/lib/format";
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
    return statementPage(report, slug, company, scope.options, query);
  }

  const companyIds = [company.id];
  const range = resolveRange(query.from, query.to);
  const accountIds = parseIds(query.accounts);

  const options = await ledgerAccountOptions(company.id);
  const runAt = new Date().toISOString();

  const filterBar = (
    <>
      <SubjectParams
        lead={<ReportCompany options={scope.options} selectedId={company.id} />}
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
  company: { id: number; isParent: boolean; label: string },
  companyOptions: Parameters<typeof CompanyFilter>[0]["options"],
  query: {
    year?: string;
    period?: string;
    mode?: string;
    cmpYear?: string;
    cmpPeriod?: string;
  }
) {
  const companyId = company.id;
  const runAt = new Date().toISOString();
  const years = await reportableFiscalYears();
  const companyFilter = <ReportCompany options={companyOptions} selectedId={companyId} />;

  if (!years.length) {
    return (
      <ReportView report={report} filter={companyFilter} runAt={runAt}>
        <ReportNeedsSubject
          icon="cal"
          title="Belum ada tahun buku aktif"
          body="Laporan keuangan dibaca per periode tahun buku. Aktifkan Fiscal Year terlebih dahulu — periode bulanannya dibuat saat itu."
        />
      </ReportView>
    );
  }

  // The Neraca is a position at the end of the period, so it has no mode: its
  // column runs from the year's first day, which is where the profit it carries
  // in equity is split.
  const neraca = report.key === "balance_sheet";
  const mode: StatementMode = !neraca && query.mode === "mtd" ? "mtd" : "ytd";
  const fallback = defaultPeriod(years);
  const main =
    resolveColumn(years, toId(query.year), toId(query.period), mode) ??
    resolveColumn(years, fallback.yearId, fallback.periodId, mode)!;
  const compare = resolveColumn(years, toId(query.cmpYear), toId(query.cmpPeriod), mode);
  const columns = compare ? [main, compare] : [main];

  // A previous year this Company has not closed yet. The books are running as
  // an extension of that year, and the report says so rather than leaving a
  // reader to find out from a figure.
  const carried = await unclosedPriorYear(companyId);
  const carriedYear = carried ? (years.find((y) => y.id === carried.id) ?? null) : null;
  const yearOf = (c: StatementColumn) => years.find((y) => y.id === c.yearId)!;
  const carrying =
    carriedYear && columns.some((c) => carriedYear.startDate < yearOf(c).startDate)
      ? carriedYear
      : null;

  const filter = (
    <>
      <FiscalPeriodParams
        lead={companyFilter}
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
        showMode={!neraca}
      />
    </>
  );

  // ----------------------------------------------------------------- neraca

  if (neraca) {
    const data = await balanceSheetReport(company, columns, carriedYear?.startDate ?? null);

    if (!data.ok) {
      return (
        <ReportView report={report} filter={filter} runAt={runAt}>
          <div className="empty sm">
            <div className="ic">
              <Icon name="warn" size={20} />
            </div>
            <h4>Neraca tidak dapat ditampilkan</h4>
            <p>
              Laba rugi yang belum dipindahkan ke ekuitas dihitung, lalu diletakkan pada
              account yang ditunjuk System Default. Belum diatur: {data.missing.join(", ")}.
            </p>
            <Link className="btn primary sm" href="/settings/system-default">
              <Icon name="gear" size={13} /> Buka System Default
            </Link>
          </div>
        </ReportView>
      );
    }

    const off = data.columns.flatMap((c, i) =>
      Math.round((data.debitTotal[i] - data.creditTotal[i]) * 100) !== 0
        ? [`${c.periodName}: selisih ${formatMoney(Math.abs(data.debitTotal[i] - data.creditTotal[i]))}`]
        : []
    );
    const opening = data.openingFrom.find(Boolean);

    return (
      <ReportView
        report={report}
        filter={filter}
        runAt={runAt}
        title={
          <StatementTitle
            name={report.name}
            companyLabel={company.label}
            mode="Posisi"
            columns={data.columns}
            runAt={runAt}
            position
          />
        }
        footnote={
          <>
            Seluruh angka dalam mata uang dasar ({BASE_CURRENCY_LABEL}), saldo kumulatif
            per akhir periode tiap kolom — laba rugi yang belum dipindahkan ke ekuitas
            dihitung dari journal dan diletakkan pada account System Default
            {openingSource(opening)}.
          </>
        }
      >
        {carrying && (
          <Notice tone="warn" title={`${carrying.name} belum ditutup untuk Company ini.`}>
            Ekuitas memuat laba rugi {carrying.name} yang belum dipindahkan ke Laba/Rugi
            Tahun Sebelumnya — angkanya berpindah ke sana saat {carrying.name} ditutup.
          </Notice>
        )}
        {off.length > 0 && (
          <Notice tone="bad" title="Aktiva tidak sama dengan Pasiva dan Ekuitas.">
            {off.join("; ")}. Setiap journal wajib seimbang, jadi selisih ini menandakan
            masalah sistem, bukan kesalahan input.
          </Notice>
        )}
        {data.postedOnComputed.length > 0 && (
          <Notice tone="bad" title="Account laba rugi yang dihitung memiliki posting.">
            Account ini tidak pernah diposting, tetapi memiliki saldo — saldonya
            dijumlahkan dengan angka yang dihitung: {data.postedOnComputed.join(", ")}.
          </Notice>
        )}
        {data.unclosedWithoutYear.length > 0 && (
          <Notice tone="bad" title="Laba rugi tahun lalu tidak nol padahal tahunnya sudah ditutup.">
            Account Laba Rugi sebelum awal tahun masih bersaldo walau tahun buku
            sebelumnya sudah ditutup. Angkanya tetap ditampilkan pada account Tahun Lalu
            Belum Ditutup agar Neraca seimbang.
          </Notice>
        )}
        {data.unplaced.length > 0 && <UnplacedNotice names={data.unplaced} />}
        <StatementReport
          key={runKey(data.columns)}
          columns={data.columns}
          rows={data.rows}
          companyId={companyId}
        />
      </ReportView>
    );
  }

  // -------------------------------------------------------------- laba rugi

  const data = await profitLossReport(companyId, columns);

  return (
    <ReportView
      report={report}
      filter={filter}
      runAt={runAt}
      title={
        <StatementTitle
          name={report.name}
          companyLabel={company.label}
          mode={STATEMENT_MODES.find((m) => m.value === mode)!.label}
          columns={data.columns}
          runAt={runAt}
        />
      }
      footnote={
        <>
          Seluruh angka dalam mata uang dasar ({BASE_CURRENCY_LABEL}), dijumlah dari
          journal yang diposting pada rentang tiap kolom — tidak termasuk journal
          penutupan tahun buku kolom itu sendiri.
        </>
      }
    >
      {carrying && (
        <Notice tone="warn" title={`${carrying.name} belum ditutup untuk Company ini.`}>
          Angka Laba Rugi tetap benar karena setiap kolom hanya menjumlah periodenya
          sendiri, tetapi hasil {carrying.name} belum dipindahkan ke Laba/Rugi Tahun
          Sebelumnya.
        </Notice>
      )}
      {data.unplaced.length > 0 && <UnplacedNotice names={data.unplaced} />}
      <StatementReport
        key={runKey(data.columns)}
        columns={data.columns}
        rows={data.rows}
        companyId={companyId}
      />
    </ReportView>
  );
}

/**
 * A new run starts its tree from the default fold — every heading open, every
 * Partner breakdown closed — rather than inheriting what the last run left.
 */
function runKey(columns: StatementColumn[]): string {
  return columns.map((c) => `${c.range.from}:${c.range.to}`).join("|");
}

/** A statement's notice: a warning the reader acts on, or a fault. */
function Notice({
  tone,
  title,
  children,
}: {
  tone: "warn" | "bad";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`nbox ${tone} slim`} style={{ margin: "0 0 12px" }}>
      <Icon name="warn" size={14} />
      <div>
        <b>{title}</b>
        <p>{children}</p>
      </div>
    </div>
  );
}

function UnplacedNotice({ names }: { names: string[] }) {
  return (
    <Notice tone="bad" title="Ada account yang bergerak tanpa tempat pada laporan ini.">
      Kategori account berikut tidak menyebut tempatnya pada laporan, sehingga nilainya
      tidak masuk ke subtotal manapun: {names.join(", ")}.
    </Notice>
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
