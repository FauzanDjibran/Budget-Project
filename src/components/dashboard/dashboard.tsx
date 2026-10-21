"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { CashBalanceTile } from "@/components/budget/cash-balance-dialog";
import { Amount } from "@/components/ui/amount";
import { Dialog } from "@/components/ui/dialog";
import { KpiTile } from "@/components/ui/kpi-tile";
import { Select } from "@/components/ui/select";
import {
  formatAgeDays,
  formatDate,
  formatMoney,
  formatTotals,
  type MoneyTotal,
} from "@/lib/format";
import { directionText } from "@/lib/siba/classification";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import type { RealizationOutcome, RealizationOutcomeRow } from "@/lib/siba/budget";
import type {
  CompanyProfitLoss,
  DashboardData,
  FunnelStage,
  IntercompanyPosition,
  StageKey,
} from "@/lib/siba/dashboard";
import { reportHref } from "@/lib/siba/reports";
import type { SubledgerPosition } from "@/lib/siba/subledger";

/**
 * The dashboard: tiles that state a figure, each opening its Rincian.
 *
 *   1. Where the position stands today — cash, intercompany, each Company's
 *      Laba Rugi to the chosen month.
 *   2. What Budgets are waiting on — approval, classification, realization.
 *      The three partition committed money: nothing is in two of them.
 *   3. How the chosen month's plan was realized.
 *   4. What the subject books stand at, per currency.
 *
 * Money is never summed across currencies (CLAUDE.md §9).
 */

type Open =
  | { kind: "stage"; key: StageKey }
  | { kind: "intercompany" }
  | { kind: "pl" }
  | { kind: "book"; bookId: number }
  | { kind: "outcome"; key: string }
  | null;

const STAGE_LOOK: Record<StageKey, { tone: "t-warn" | "t-acc" | "t-info"; icon: "clock" | "tags" | "send" }> = {
  approval: { tone: "t-warn", icon: "clock" },
  classification: { tone: "t-acc", icon: "tags" },
  execution: { tone: "t-info", icon: "send" },
};

export function Dashboard({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);

  const stage = open?.kind === "stage" ? data.stages.find((s) => s.key === open.key) : undefined;
  const book = open?.kind === "book" ? data.books.find((b) => b.bookId === open.bookId) : undefined;
  const outcome =
    open?.kind === "outcome"
      ? data.plan.find((r) => `${r.budgetType}|${r.currencyId}` === open.key)
      : undefined;

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
            Dashboard
          </h1>
        </div>
      </div>

      {/* Today's position: none of it moves with the Periode below. */}
      <div className="dsec">
        <h2>Posisi Saat Ini</h2>
        <p>per hari ini, tidak dipengaruhi periode</p>
      </div>

      <div className="kpis trio">
        {data.stages.map((s) => (
          <StageTile key={s.key} stage={s} onOpen={() => setOpen({ kind: "stage", key: s.key })} />
        ))}
      </div>

      <div className="dgrid">
        <div className="dstack">
          <CashBalanceTile cash={data.cash} />
          <IntercompanyTile ic={data.intercompany} onOpen={() => setOpen({ kind: "intercompany" })} />
        </div>
        <BookCard books={data.books} onOpen={(bookId) => setOpen({ kind: "book", bookId })} />
      </div>

      {/* Everything here reads the chosen month, and the picker sits beside it. */}
      <div className="dsec">
        <h2>Periode</h2>
        <p>Laba Rugi s.d. bulan ini, Budget bertanggal bulan ini</p>
        {data.months.length > 0 && (
          <div className="act">
            <Select
              variant="toolbar"
              value={data.month ? String(data.month.periodId) : ""}
              options={data.months.map((m) => ({ value: String(m.periodId), label: m.name }))}
              onChange={(v) => router.push(`/dashboard?period=${v}`)}
              placeholder="Pilih Periode…"
              ariaLabel="Periode"
              searchable
            />
          </div>
        )}
      </div>

      <div className="dgrid">
        <ProfitLossTile pl={data.profitLoss} onOpen={() => setOpen({ kind: "pl" })} />
        <OutcomeCard data={data} onOpen={(key) => setOpen({ kind: "outcome", key })} />
      </div>

      {stage && <StageDialog stage={stage} onClose={close} />}
      {open?.kind === "intercompany" && (
        <IntercompanyDialog ic={data.intercompany} onClose={close} />
      )}
      {open?.kind === "pl" && <ProfitLossDialog pl={data.profitLoss} onClose={close} />}
      {book && <BookDialog book={book} onClose={close} />}
      {outcome && <OutcomeDialog row={outcome} onClose={close} />}
    </>
  );
}

// ------------------------------------------------------------------- tiles

/** A total that spans currencies, or `Rp 0` where nothing is waiting — never a dash. */
const totalsOrZero = (totals: MoneyTotal[]) =>
  totals.length ? formatTotals(totals) : formatMoney(0, BASE_CURRENCY_LABEL);

/** `Pengeluaran Rp 1.000 · USD 50` and its Penerimaan twin, one line each. */
function DirectionLines({ outTotals, inTotals }: { outTotals: MoneyTotal[]; inTotals: MoneyTotal[] }) {
  return (
    <>
      <span className={`dl${outTotals.length ? "" : " z"}`}>
        Pengeluaran <b>{totalsOrZero(outTotals)}</b>
      </span>
      <span className={`dl${inTotals.length ? "" : " z"}`}>
        Penerimaan <b>{totalsOrZero(inTotals)}</b>
      </span>
    </>
  );
}

function StageTile({ stage, onOpen }: { stage: FunnelStage; onOpen: () => void }) {
  const look = STAGE_LOOK[stage.key];
  return (
    <KpiTile
      icon={look.icon}
      tone={look.tone}
      label={stage.name}
      more="Rincian"
      value={stage.count}
      detail={
<DirectionLines outTotals={stage.outTotals} inTotals={stage.inTotals} />
      }
      onClick={onOpen}
    />
  );
}

/** One tile, one line per Company: Laba Bersih from the year's start to the month. */
function ProfitLossTile({ pl, onOpen }: { pl: CompanyProfitLoss[]; onOpen: () => void }) {
  const period = pl.find((p) => p.column)?.column?.periodName;
  return (
    <KpiTile
      icon="trend"
      tone="t-ok"
      label="Laba Rugi"
      more="Rincian"
      lines={pl.map((p) => (
        <span className="kl" key={p.companyId}>
          <small>{p.companyLabel}</small>
          {p.column ? (
            <span className={p.net < 0 ? "neg" : undefined}>
              {formatMoney(p.net, BASE_CURRENCY_LABEL)}
            </span>
          ) : (
            <span className="dash">—</span>
          )}
        </span>
      ))}
      detail={period ? `Laba bersih s.d. ${period}` : "Tahun Buku untuk periode ini belum dibuka"}
      onClick={onOpen}
    />
  );
}

/** Net of the induk's two bridge accounts: what the anak owes it, or the reverse. */
function intercompanyNet(ic: IntercompanyPosition) {
  // Sides arrive induk AR, induk AP, anak AR, anak AP (dashboardData orders them).
  const [indukAr, indukAp, anakAr, anakAp] = ic.sides;
  const net = (indukAr?.balance ?? 0) - (indukAp?.balance ?? 0);
  const mirror = (anakAp?.balance ?? 0) - (anakAr?.balance ?? 0);
  return {
    net,
    mirrors: Math.round(net * 100) === Math.round(mirror * 100),
    indukLabel: indukAr?.companyLabel ?? "induk",
    anakLabel: anakAr?.companyLabel ?? "anak",
  };
}

function IntercompanyTile({ ic, onOpen }: { ic: IntercompanyPosition; onOpen: () => void }) {
  if (!ic.ok || ic.sides.length !== 4) {
    return (
      <KpiTile
        icon="build"
        tone="t-warn"
        label="Posisi Intercompany"
        more="Rincian"
        value="—"
        detail="Account bridge belum lengkap"
        onClick={onOpen}
      />
    );
  }
  const { net, mirrors, indukLabel, anakLabel } = intercompanyNet(ic);
  const settled = Math.round(net * 100) === 0;
  return (
    <KpiTile
      icon="build"
      tone={mirrors ? "t-info" : "t-bad"}
      label="Posisi Intercompany"
      more="Rincian"
      value={formatMoney(Math.abs(net), BASE_CURRENCY_LABEL)}
      detail={
        !mirrors
          ? "Kedua sisi tidak saling mencerminkan"
          : settled
            ? "Tidak ada posisi antar Company"
            : net > 0
              ? `${anakLabel} berhutang ke ${indukLabel}`
              : `${indukLabel} berhutang ke ${anakLabel}`
      }
      onClick={onOpen}
    />
  );
}

// ------------------------------------------------------------ period cards

const OUTCOMES: { key: RealizationOutcome; label: string; tone: string }[] = [
  { key: "under", label: "Kurang", tone: "s-warn" },
  { key: "match", label: "Sesuai", tone: "s-ok" },
  { key: "over", label: "Lebih", tone: "s-bad" },
];

/**
 * How the month's realizable Budgets turned out against their nominal. One row
 * per direction × currency; each outcome states how many Budgets and how much —
 * the shortfall, the nominal, or the excess. A row opens its Budgets.
 */
function OutcomeCard({
  data,
  onOpen,
}: {
  data: DashboardData;
  onOpen: (key: string) => void;
}) {
  return (
    <div className="card">
      <div className="card-h">
        <span className="ci">
          <Icon name="scale" size={15} />
        </span>
        <div className="ct">
          <h3>Realisasi vs Rencana</h3>
          <p>
            {data.month
              ? `Budget Open dan Closed bertanggal ${data.month.name}`
              : "Belum ada periode"}
          </p>
        </div>
      </div>

      {data.plan.length ? (
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th>Arah · Currency</th>
                {OUTCOMES.map((o) => (
                  <th className="num" key={o.key}>
                    {o.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.plan.map((r) => (
                <tr
                  key={`${r.budgetType}|${r.currencyId}`}
                  className="clk"
                  onClick={() => onOpen(`${r.budgetType}|${r.currencyId}`)}
                >
                  <td className="pri">
                    {directionText(r.budgetType)} · {r.currencyLabel}
                    <span className="rsub">{r.budgets.length} Budget</span>
                  </td>
                  {OUTCOMES.map((o) => (
                    <td className="num" key={o.key}>
                      <Amount value={r[o.key].amount} currency={r.currencyLabel} nil="dash" />
                      <span className="rsub">{r[o.key].count} Budget</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty sm">
          <div className="ic">
            <Icon name="scale" size={20} />
          </div>
          <h4>Tidak ada Budget Open atau Closed pada periode ini</h4>
          <p>Pilih periode lain di atas.</p>
        </div>
      )}
      <p className="foot-note" style={{ padding: "0 16px 14px" }}>
        Kurang menyebut sisa yang belum direalisasi, Sesuai nominalnya, Lebih kelebihannya.
      </p>
    </div>
  );
}

function OutcomeDialog({ row, onClose }: { row: RealizationOutcomeRow; onClose: () => void }) {
  return (
    <Dialog
      open
      icon="scale"
      tone="brand"
      width={960}
      title={`Realisasi vs Rencana · ${directionText(row.budgetType)} ${row.currencyLabel}`}
      subtitle={`${row.budgets.length} Budget`}
      onClose={onClose}
      foot={
        <button className="btn primary" onClick={onClose}>
          Tutup
        </button>
      }
    >
      <div className="tw boxed">
        <table className="grid">
          <thead>
            <tr>
              <th>Budget</th>
              <th style={{ width: 90 }}>Company</th>
              <th style={{ width: 90 }}>Hasil</th>
              <th className="num" style={{ width: 150 }}>Nominal</th>
              <th className="num" style={{ width: 150 }}>Realisasi</th>
              <th className="num" style={{ width: 150 }}>Selisih</th>
            </tr>
          </thead>
          <tbody>
            {OUTCOMES.flatMap((o) =>
              row.budgets
                .filter((b) => b.outcome === o.key)
                .map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link className="pri" href={`/budget/budget/${b.id}`}>
                        {b.budgetNo}
                      </Link>
                      <span className="rsub">
                        {b.description}
                        {b.categoryName ? ` · ${b.categoryName}` : ""}
                      </span>
                    </td>
                    <td className="mut">{b.companyLabel}</td>
                    <td>
                      <span className={`bdg ${o.tone}`}>{o.label}</span>
                    </td>
                    <td className="num">
                      <Amount value={b.planned} currency={row.currencyLabel} />
                    </td>
                    <td className="num">
                      <Amount value={b.realized} currency={row.currencyLabel} />
                    </td>
                    <td className="num">
                      <Amount value={b.realized - b.planned} currency={row.currencyLabel} nil="dash" ledger />
                    </td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

/**
 * What every subject book stands at, one row per book and one column per
 * currency — a matrix, because a position held in two currencies is two
 * figures and never one. A row opens the book's Partners.
 */
function BookCard({
  books,
  onOpen,
}: {
  books: SubledgerPosition[];
  onOpen: (bookId: number) => void;
}) {
  const currencies = [...new Set(books.flatMap((b) => b.totals.map((t) => t.currencyLabel)))].sort(
    (a, b) => (a === BASE_CURRENCY_LABEL ? -1 : b === BASE_CURRENCY_LABEL ? 1 : a.localeCompare(b))
  );
  return (
    <div className="card">
      <div className="card-h">
        <span className="ci">
          <Icon name="book" size={15} />
        </span>
        <div className="ct">
          <h3>Posisi Buku Subjek</h3>
          <p>Saldo berjalan per buku, hari ini</p>
        </div>
      </div>
      {books.length ? (
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th>Buku</th>
                <th className="num" style={{ width: 70 }}>
                  Partner
                </th>
                {currencies.map((c) => (
                  <th className="num" key={c}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.bookId} className="clk" onClick={() => onOpen(b.bookId)}>
                  <td className="pri">{b.name}</td>
                  <td className="num">{b.subjects}</td>
                  {currencies.map((c) => {
                    const t = b.totals.find((x) => x.currencyLabel === c);
                    return (
                      <td className="num" key={c}>
                        <Amount value={t?.amount ?? 0} currency={c} nil="dash" />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty sm">
          <div className="ic">
            <Icon name="book" size={20} />
          </div>
          <h4>Belum ada posisi berjalan</h4>
          <p>Buku subjek terisi saat dokumen Finance diposting.</p>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- dialogs

function StageDialog({ stage, onClose }: { stage: FunnelStage; onClose: () => void }) {
  const look = STAGE_LOOK[stage.key];
  const execution = stage.key === "execution";
  return (
    <Dialog
      open
      icon={look.icon}
      tone="brand"
      width={900}
      title={stage.name}
      subtitle={`${stage.count} Budget, terlama di atas`}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            Tutup
          </button>
          <Link className="btn primary" href={stage.href}>
            Buka Antrian
          </Link>
        </>
      }
    >
      {stage.rows.length ? (
        <div className="tw boxed">
          <table className="grid">
            <thead>
              <tr>
                <th>Budget</th>
                <th style={{ width: 90 }}>Company</th>
                <th style={{ width: 110 }}>Arah</th>
                <th style={{ width: 100 }}>Tanggal</th>
                <th className="num" style={{ width: 170 }}>
                  {execution ? "Sisa" : "Nominal"}
                </th>
              </tr>
            </thead>
            <tbody>
              {stage.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link className="pri" href={r.href}>
                      {r.budgetNo}
                    </Link>
                    <span className="rsub">
                      {r.description} · {formatAgeDays(r.since)}
                    </span>
                  </td>
                  <td className="mut">{r.companyLabel}</td>
                  <td className="mut">{directionText(r.budgetType)}</td>
                  <td className="mut">{formatDate(r.budgetDate)}</td>
                  <td className="num">
                    <Amount value={r.amount} currency={r.currencyLabel} />
                  </td>
                </tr>
              ))}
              {[...stage.outTotals.map((t) => ["Out", t] as const), ...stage.inTotals.map((t) => ["In", t] as const)].map(
                  ([type, t]) => (
                    <tr className="totrow" key={`${type}${t.currencyId}`}>
                      <td colSpan={4}>
                        Total {directionText(type)} {t.currencyLabel}
                      </td>
                      <td className="num">
                        <Amount value={t.amount} currency={t.currencyLabel} />
                      </td>
                    </tr>
                  )
                )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty sm">
          <div className="ic">
            <Icon name="check" size={20} />
          </div>
          <h4>Tidak ada yang menunggu</h4>
          <p>Antrian ini sedang kosong.</p>
        </div>
      )}
    </Dialog>
  );
}

function IntercompanyDialog({ ic, onClose }: { ic: IntercompanyPosition; onClose: () => void }) {
  return (
    <Dialog
      open
      icon="build"
      tone="brand"
      width={720}
      title="Posisi Intercompany"
      subtitle="Saldo account bridge antara induk dan anak"
      onClose={onClose}
      foot={
        <button className="btn primary" onClick={onClose}>
          Tutup
        </button>
      }
    >
      {ic.ok && ic.sides.length ? (
        <>
          <div className="tw boxed">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Company</th>
                  <th>Account</th>
                  <th className="num" style={{ width: 180 }}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {ic.sides.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className="bdg t-slate">{a.companyLabel}</span>
                    </td>
                    <td>
                      <span className="idc">
                        <span className="lab">{a.label}</span>
                        <span className="nm">{a.name}</span>
                      </span>
                    </td>
                    <td className="num">
                      <Amount value={a.balance} nil="dash" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!intercompanyNet(ic).mirrors && (
            <p className="foot-note">
              Piutang induk dan hutang anak seharusnya bernilai sama; selisih ini perlu diperiksa
              melalui General Ledger.
            </p>
          )}
        </>
      ) : (
        <div className="empty sm">
          <div className="ic t-warn">
            <Icon name="warn" size={20} />
          </div>
          <h4>Bridge belum lengkap</h4>
          <p>Belum diatur: {ic.missing.join(", ") || "—"}.</p>
          <div className="cta">
            <Link className="btn sm" href="/accounting/system-account">
              Atur Mapping Account System
            </Link>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function ProfitLossDialog({ pl, onClose }: { pl: CompanyProfitLoss[]; onClose: () => void }) {
  // Every Company's statement has the same steps, so the first one with a column names the rows.
  const lines = pl.find((p) => p.lines.length)?.lines ?? [];
  const period = pl.find((p) => p.column)?.column;
  return (
    <Dialog
      open
      icon="trend"
      tone="brand"
      width={760}
      title="Laba Rugi"
      subtitle={period ? `${period.yearName}, s.d. ${period.periodName}` : "Tahun Buku belum dibuka"}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            Tutup
          </button>
          {pl.map(
            (p) =>
              p.column && (
                <Link key={p.companyId} className="btn" href={p.column.href}>
                  Laba Rugi {p.companyLabel}
                </Link>
              )
          )}
        </>
      }
    >
      {lines.length ? (
        <div className="tw boxed">
          <table className="grid">
            <thead>
              <tr>
                <th />
                {pl.map((p) => (
                  <th className="num" key={p.companyId} style={{ width: 200 }}>
                    {p.companyLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className={l.result ? "totrow" : undefined}>
                  <td>{l.name}</td>
                  {pl.map((p) => {
                    const v = p.lines.find((x) => x.key === l.key);
                    return (
                      <td className="num" key={p.companyId}>
                        {v ? <Amount value={v.value} ledger /> : <span className="dash">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty sm">
          <div className="ic">
            <Icon name="cal" size={20} />
          </div>
          <h4>Tahun Buku belum dibuka</h4>
          <p>Belum ada Company dengan periode fiskal untuk bulan ini.</p>
        </div>
      )}
    </Dialog>
  );
}

function BookDialog({ book, onClose }: { book: SubledgerPosition; onClose: () => void }) {
  return (
    <Dialog
      open
      icon="book"
      tone="brand"
      width={820}
      title={book.name}
      subtitle={`${book.subjects} posisi Partner berjalan`}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            Tutup
          </button>
          <Link className="btn primary" href={reportHref("subledger-balance", { book: book.bookId })}>
            Buka Saldo Buku Subjek
          </Link>
        </>
      }
    >
      <div className="tw boxed">
        <table className="grid">
          <thead>
            <tr>
              <th>Partner</th>
              <th className="num" style={{ width: 90 }}>Open Item</th>
              <th style={{ width: 120 }}>Item Tertua</th>
              <th className="num" style={{ width: 180 }}>{book.closingLabel}</th>
            </tr>
          </thead>
          <tbody>
            {book.partners.map((p) => (
              <tr key={`${p.partnerId}|${p.currencyLabel}`}>
                <td>
                  <span className="idc">
                    <span className="lab">{p.partnerLabel}</span>
                    <span className="nm">{p.partnerName}</span>
                  </span>
                </td>
                <td className="num">{p.openItems}</td>
                <td className="mut">{p.oldest ? formatDate(p.oldest) : "—"}</td>
                <td className="num">
                  <Amount value={p.balance} currency={p.currencyLabel} />
                </td>
              </tr>
            ))}
            {book.totals.map((t) => (
              <tr className="totrow" key={t.currencyId}>
                <td colSpan={3}>Total {t.currencyLabel}</td>
                <td className="num">
                  <Amount value={t.amount} currency={t.currencyLabel} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
