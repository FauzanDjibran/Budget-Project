"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { BudgetPlanTile } from "@/components/budget/budget-plan-tile";
import { CashBalanceTile } from "@/components/budget/cash-balance-dialog";
import { LayerPositionTile } from "@/components/finance/layer-position-tile";
import { Amount } from "@/components/ui/amount";
import { Dialog } from "@/components/ui/dialog";
import { KpiTile } from "@/components/ui/kpi-tile";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import type {
  CompanyProfitLoss,
  DashboardData,
  IntercompanyPosition,
} from "@/lib/siba/dashboard";
import { reportHref } from "@/lib/siba/reports";
import type { SubledgerPosition } from "@/lib/siba/subledger";

/**
 * The dashboard: tiles that state a figure, each opening its Rincian.
 *
 *   1. Where the position stands today — cash, rate layers, intercompany, and
 *      the subject books, one row per book so a new Budget Category needs no
 *      new card.
 *   2. The chosen month — its Budgets, Pengeluaran and Penerimaan, drawn by
 *      the Budget page's own tile, and each Company's Laba Rugi to date.
 *
 * Money is never summed across currencies (CLAUDE.md §9).
 */

type Open = { kind: "intercompany" } | { kind: "pl" } | { kind: "book"; bookId: number } | null;

export function Dashboard({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);

  const book = open?.kind === "book" ? data.books.find((b) => b.bookId === open.bookId) : undefined;
  const currencyLabel = new Map(data.currencies.map((c) => [c.id, c.label]));
  const categoryById = new Map(data.categories.map((c) => [c.id, c]));
  const currencyOf = (id: number) => currencyLabel.get(id) ?? BASE_CURRENCY_LABEL;
  const categoryOf = (id: number | null) => (id == null ? null : categoryById.get(id) ?? null);

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
        <CashBalanceTile cash={data.cash} />
        {/* Nothing held in foreign currency has no layer to show. */}
        {data.layers.resources > 0 && <LayerPositionTile report={data.layers} />}
        <IntercompanyTile ic={data.intercompany} onOpen={() => setOpen({ kind: "intercompany" })} />
      </div>

      <BookCard books={data.books} onOpen={(bookId) => setOpen({ kind: "book", bookId })} />

      {/* Everything here reads the chosen month, and the picker sits beside it. */}
      <div className="dsec">
        <h2>Periode</h2>
        <p>Budget bertanggal bulan ini, Laba Rugi s.d. bulan ini</p>
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

      <div className="kpis trio">
        {(["Out", "In"] as const).map((d) => (
          <BudgetPlanTile
            key={d}
            budgets={data.budgets.filter((b) => b.budget_type === d)}
            direction={d}
            tabLabel={data.month?.name ?? "—"}
            showRemaining
            currencyOf={currencyOf}
            categoryOf={categoryOf}
          />
        ))}
        <ProfitLossTile pl={data.profitLoss} onOpen={() => setOpen({ kind: "pl" })} />
      </div>

      {open?.kind === "intercompany" && (
        <IntercompanyDialog ic={data.intercompany} onClose={close} />
      )}
      {open?.kind === "pl" && <ProfitLossDialog pl={data.profitLoss} onClose={close} />}
      {book && <BookDialog book={book} onClose={close} />}
    </>
  );
}

// ------------------------------------------------------------------- tiles

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
