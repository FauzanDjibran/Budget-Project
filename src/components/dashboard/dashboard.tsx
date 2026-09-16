import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";
import { formatAgeDays, formatMoney, formatTotals } from "@/lib/format";
import type {
  DashboardData,
  StageKey,
  TaskRow,
} from "@/lib/siba/dashboard";
import { reportHref } from "@/lib/siba/reports";

/**
 * The dashboard.
 *
 * Four questions, each answered in exactly one place:
 *
 *   1. What is waiting, and on whom — the commitment funnel.
 *   2. Where the money is, and what is already spoken for — cash.
 *   3. What the company owes and is owed — the subject books and the bridge.
 *   4. What is broken or unset — system health.
 *
 * Nothing is restated in a second form. The funnel's tiles say *how much* is
 * in each stage; the queue beneath them says *which record to open*, which is
 * a different fact about the same records rather than the same fact twice. No
 * master-data counts, no per-Company spread of those counts, no re-slicing of
 * the same budgets by month.
 *
 * Money is never summed across currencies (CLAUDE.md §12).
 */

const STAGE_TINT: Record<StageKey, { bg: string; fg: string; icon: IconName }> = {
  approval: { bg: "var(--warn-bg)", fg: "var(--warn)", icon: "clock" },
  execution: { bg: "var(--info-bg)", fg: "var(--info)", icon: "send" },
  funding: { bg: "var(--vio-bg)", fg: "var(--vio)", icon: "link" },
};

/** What the row wants done, in one word — the queue is mixed, so it must say. */
const STAGE_TAG: Record<StageKey, string> = {
  approval: "Setujui",
  execution: "Realisasikan",
  funding: "Konfirmasi",
};

/** How many rows the queue shows before it stops and points at the lists. */
const QUEUE_LIMIT = 8;

export function Dashboard({ data }: { data: DashboardData }) {
  const { funnel, cash, positions, intercompany, health } = data;
  const waiting = funnel.tasks.length;
  const shown = funnel.tasks.slice(0, QUEUE_LIMIT);
  const books = positions.filter((p) => p.subjects > 0);
  const flagged = health.unbalanced.length + health.attention.length;

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
        <p className="ph-sub">
          Komitmen yang sedang berjalan, posisi kas, dan posisi terhadap pihak
          lain. Dokumen berstatus Draft tidak dihitung di mana pun — draft
          adalah dokumen persiapan yang belum tentu terjadi.
        </p>
      </div>

      {/* 1 — the funnel. Every rupiah of committed money sits in exactly one
          of these, and the three together are the whole of what has been
          committed but has not yet reached a book. */}
      <div className="kpis bud">
        {funnel.stages.map((s) => {
          const tint = STAGE_TINT[s.key];
          return (
            <Link
              key={s.key}
              href={s.href}
              className="kpi"
              style={{ display: "block", textDecoration: "none" }}
            >
              <div className="h">
                <span className="i" style={{ background: tint.bg, color: tint.fg }}>
                  <Icon name={tint.icon} size={14} />
                </span>
                <span className="l">{s.name}</span>
                <span className="more">
                  Buka
                  <Icon name="chev" size={11} />
                </span>
              </div>
              <div className="v">{s.count}</div>
              <div className="d">{formatTotals(s.totals)}</div>
            </Link>
          );
        })}
      </div>

      <div className="two">
        {/* The same records the tiles counted, as things to open. */}
        <div className="card">
          <div className="card-h">
            <span className="ci">
              <Icon name="clip" size={15} />
            </span>
            <div className="ct">
              <h3>Antrian Tindakan</h3>
              <p>
                {waiting
                  ? `${waiting} dokumen menunggu tindakan, terlama di atas`
                  : "Tidak ada dokumen yang menunggu"}
              </p>
            </div>
          </div>

          {shown.length ? (
            <>
              {shown.map((t) => (
                <QueueRow key={t.key} task={t} />
              ))}
              {waiting > shown.length && (
                <div className="att" style={{ cursor: "default" }}>
                  <span className="b">
                    <span>
                      {waiting - shown.length} lainnya menunggu. Buka salah satu
                      kartu di atas untuk melihat daftar lengkapnya.
                    </span>
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="empty sm">
              <div className="ic">
                <Icon name="check" size={20} />
              </div>
              <h4>Tidak ada yang menunggu</h4>
              <p>
                Tidak ada Budget yang menunggu persetujuan, menunggu
                direalisasikan, atau menunggu konfirmasi induk.
              </p>
            </div>
          )}
        </div>

        {/* 2 — cash, and what the funnel above will do to it. */}
        <div className="card">
          <div className="card-h">
            <span className="ci">
              <Icon name="wallet2" size={15} />
            </span>
            <div className="ct">
              <h3>Posisi Kas &amp; Bank</h3>
              <p>
                {cash.resources} resource aktif, saldo dari Cash Bank Book
              </p>
            </div>
            <Link className="btn sm ghost" href={reportHref("cash-bank-balance")}>
              Buku
            </Link>
          </div>
          <CashTable data={data} />
        </div>
      </div>

      <div className="two" style={{ marginTop: 14 }}>
        {/* 3a — what Partners owe and are owed. */}
        <div className="card">
          <div className="card-h">
            <span className="ci">
              <Icon name="users" size={15} />
            </span>
            <div className="ct">
              <h3>Posisi Buku Subjek</h3>
              <p>Posisi berjalan tiap buku terhadap Partner</p>
            </div>
          </div>

          {books.length ? (
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Buku</th>
                    <th className="num" style={{ width: 70 }}>
                      Subjek
                    </th>
                    <th className="num" style={{ width: 190 }}>
                      Posisi
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {books.map((b) => (
                    <tr key={b.key}>
                      <td>
                        <Link className="pri" href={reportHref(b.slug)}>
                          {b.name}
                        </Link>
                        <span className="rsub">{b.closingLabel}</span>
                      </td>
                      <td className="num">{b.subjects}</td>
                      <td className="num">{formatTotals(b.totals)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty sm">
              <div className="ic">
                <Icon name="users" size={20} />
              </div>
              <h4>Belum ada posisi berjalan</h4>
              <p>
                Buku subjek terisi saat dokumen Finance diposting untuk Budget
                Category yang menyebut Partner.
              </p>
            </div>
          )}
        </div>

        {/* 3b — what the two Companies owe one another. Journal, never a
            subject book: the other Company is not a Partner (§10 rule 61). */}
        <div className="card">
          <div className="card-h">
            <span className="ci">
              <Icon name="build" size={15} />
            </span>
            <div className="ct">
              <h3>Posisi Intercompany</h3>
              <p>Saldo akun bridge antara induk dan anak</p>
            </div>
          </div>

          {intercompany.ok && intercompany.sides.length ? (
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 84 }}>Company</th>
                    <th>Account</th>
                    <th className="num" style={{ width: 180 }}>
                      Posisi
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {intercompany.sides.map((a) => (
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
                      <td className="num">{formatTotals(a.totals)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty sm">
              <div className="ic" style={{ background: "var(--warn-bg)", color: "var(--warn)" }}>
                <Icon name="warn" size={20} />
              </div>
              <h4>Bridge belum lengkap</h4>
              <p>
                Posisi antar Company dibaca dari empat akun bridge. Belum
                diatur: {intercompany.missing.join(", ") || "—"}.
              </p>
              <div className="cta">
                <Link className="btn sm" href="/settings/system-default">
                  Atur System Default
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4 — only when something is wrong. A healthy system says nothing,
          the way a report only speaks about balance when it is broken. */}
      {flagged > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <span className="ci" style={{ background: "var(--warn-bg)", color: "var(--warn)" }}>
              <Icon name="warn" size={15} />
            </span>
            <div className="ct">
              <h3>Perlu Perhatian</h3>
              <p>{flagged} hal yang sebaiknya diselesaikan</p>
            </div>
          </div>

          {health.unbalanced.length > 0 && (
            <Link
              href="/accounting/journal"
              className="att"
              style={{ textDecoration: "none" }}
            >
              <span className="i" style={{ background: "var(--bad-bg)", color: "var(--bad)" }}>
                <Icon name="warn" size={14} />
              </span>
              <span className="b">
                <b>{health.unbalanced.length} journal tidak seimbang</b>
                <span>
                  Setiap journal wajib seimbang saat ditulis, jadi ini kesalahan
                  sistem — bukan kesalahan pembukuan. Nomor:{" "}
                  {health.unbalanced.slice(0, 4).map((j) => j.journalNo).join(", ")}
                  {health.unbalanced.length > 4
                    ? `, dan ${health.unbalanced.length - 4} lainnya.`
                    : "."}
                </span>
              </span>
            </Link>
          )}

          {health.attention.map((a) => (
            <Link
              key={a.title}
              href={a.href}
              className="att"
              style={{ textDecoration: "none" }}
            >
              <span className="i" style={{ background: "var(--warn-bg)", color: "var(--warn)" }}>
                <Icon name="warn" size={14} />
              </span>
              <span className="b">
                <b>{a.title}</b>
                <span>{a.detail}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function QueueRow({ task }: { task: TaskRow }) {
  const tint = STAGE_TINT[task.stage];
  return (
    <Link href={task.href} className="att" style={{ textDecoration: "none" }}>
      <span className="i" style={{ background: tint.bg, color: tint.fg }}>
        <Icon name={tint.icon} size={14} />
      </span>
      <span className="b">
        <b>
          {task.title}
          <span className="bdg t-slate" style={{ marginLeft: 6 }}>
            {STAGE_TAG[task.stage]}
          </span>
        </b>
        <span>
          {task.subtitle} · {task.companyLabel} ·{" "}
          {formatMoney(task.amount, task.currencyLabel)} ·{" "}
          {formatAgeDays(task.since)}
        </span>
      </span>
    </Link>
  );
}

/**
 * Cash, and what the approved half of the funnel will do to it.
 *
 * The commitment columns are the funnel's stages 2 and 3 *in total* — not
 * broken down again by stage, which the tiles above already did. Stage 1 is
 * excluded on purpose: a Budget nobody has approved is not yet a claim on
 * anyone's cash.
 */
function CashTable({ data }: { data: DashboardData }) {
  const { cash, funnel } = data;

  const rows = new Map<
    number,
    { label: string; balance: number; out: number; in: number }
  >();
  const at = (currencyId: number, currencyLabel: string) => {
    const row = rows.get(currencyId) ?? {
      label: currencyLabel,
      balance: 0,
      out: 0,
      in: 0,
    };
    rows.set(currencyId, row);
    return row;
  };

  for (const c of cash.byCurrency) at(c.currencyId, c.currencyLabel).balance = c.balance;
  for (const t of funnel.committedOut) at(t.currencyId, t.currencyLabel).out = t.amount;
  for (const t of funnel.committedIn) at(t.currencyId, t.currencyLabel).in = t.amount;

  const list = [...rows.entries()].sort((a, b) =>
    a[1].label.localeCompare(b[1].label)
  );

  if (!list.length) {
    return (
      <div className="empty sm">
        <div className="ic">
          <Icon name="wallet2" size={20} />
        </div>
        <h4>Belum ada resource kas</h4>
        <p>
          Daftarkan Cash &amp; Bank beserta saldo awalnya agar posisi kas dapat
          dibaca dari bukunya.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="tw">
        <table className="grid">
          <thead>
            <tr>
              <th style={{ width: 62 }}>Mata Uang</th>
              <th className="num">Saldo</th>
              <th className="num">Komitmen Keluar</th>
              <th className="num">Ekspektasi Masuk</th>
              <th className="num">Proyeksi</th>
            </tr>
          </thead>
          <tbody>
            {list.map(([id, r]) => (
              <tr key={id}>
                <td>
                  <span className="lab">{r.label}</span>
                </td>
                <td className="num">{formatMoney(r.balance, r.label)}</td>
                <td className="num mut">
                  {r.out ? formatMoney(-r.out, r.label) : "—"}
                </td>
                <td className="num mut">
                  {r.in ? formatMoney(r.in, r.label) : "—"}
                </td>
                <td className="num pri">
                  {formatMoney(r.balance - r.out + r.in, r.label)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="foot-note" style={{ padding: "0 16px 14px" }}>
        Proyeksi memperhitungkan Budget yang sudah disetujui dan belum menjadi
        kas — termasuk yang sedang menunggu konfirmasi induk. Budget yang masih
        menunggu persetujuan tidak dihitung, dan nilai antar mata uang tidak
        pernah dijumlahkan.
      </p>
    </>
  );
}
