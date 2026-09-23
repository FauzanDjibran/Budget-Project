"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icon";
import { CompanyFilter, NoCompanyAccess } from "@/components/master/company-filter";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { closeFiscalYear } from "@/app/actions/closing";
import { formatDate, formatMoney } from "@/lib/format";
import type { Company } from "@/lib/siba/company-access";
import type { ClosingPlan } from "@/lib/siba/closing";
import { BASE_CURRENCY_LABEL } from "@/lib/siba/currency";
import { FISCAL_YEAR_TRANSITIONS } from "@/lib/siba/fiscal-workflow";
import { headerButtonClass } from "@/lib/siba/header-actions";

/**
 * Closing a fiscal year: the checklist, the entry, and one confirm.
 *
 * Three things in one screen, in the order somebody works through them. What
 * is blocking, if anything — stated as conditions rather than as one refusal,
 * because several can be wrong at once and each is somebody's to fix. Then the
 * journal that is about to be posted, in full, because a closing entry moves a
 * whole year's result and is irreversible. Then the single button.
 *
 * The checklist is the enforcement read back, not a second opinion: the Server
 * Action runs the same checks again before it writes, so nothing here can offer
 * a close that would be refused, and nothing refused here is quietly allowed.
 *
 * Company and year are `?company=` and `?year=` rather than component state,
 * for the reason every Report View's parameters are: a run is a navigation, the
 * page stays a Server Component that queries directly, and a colleague can be
 * sent the exact screen.
 */
export function ClosingWorkspace({
  plan,
  years,
  companies,
  companyId,
  yearId,
  canClose,
}: {
  /** Null when no year is chosen, or the pair does not resolve. */
  plan: ClosingPlan | null;
  years: { id: number; label: string; name: string; closed: boolean }[];
  companies: Company[];
  companyId: number | null;
  yearId: number | null;
  canClose: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const transition = FISCAL_YEAR_TRANSITIONS.close;

  const pickYear = (value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("year", value);
    router.push(`?${next.toString()}`);
  };

  const run = async () => {
    if (!plan || !companyId || !yearId) return;
    setBusy(true);
    const result = await closeFiscalYear(companyId, yearId);
    setBusy(false);
    setConfirm(false);
    if (!result.ok) {
      toast("Tidak dapat ditutup", result.message, "err");
      return;
    }
    toast(
      result.message,
      [result.journalNo, result.openingNo].filter(Boolean).join(" · ") ||
        "Tidak ada journal penutup — tahun buku ini tidak memiliki hasil untuk dipindahkan",
      "ok"
    );
    router.refresh();
  };

  const offer = canClose && plan?.ready && !plan.closed;

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Accounting</span>
          <span>/</span>
          <span className="cur">Fiscal Year Closing</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="lock" size={16} />
            </span>
            Fiscal Year Closing
          </h1>
          <div className="ph-act">
            {offer && (
              <button
                className={headerButtonClass(transition.tone)}
                disabled={busy}
                onClick={() => setConfirm(true)}
              >
                <Icon name={transition.icon} size={15} /> {transition.label}
              </button>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Penutupan dilakukan per Company. Hasil tahun berjalan dipindahkan ke
          Laba/Rugi Tahun Sebelumnya, dan posisi yang tersisa ditulis sebagai
          Opening Balance tahun berikutnya. Tidak dapat dibatalkan.
        </p>
      </div>

      {companyId == null ? (
        <div className="card">
          <NoCompanyAccess what="Tahun buku" />
        </div>
      ) : (
        <>
          <div className="card">
            <div className="toolbar">
              <CompanyFilter options={companies} selectedId={companyId} />
              <Select
                variant="toolbar"
                value={yearId ? String(yearId) : ""}
                onChange={pickYear}
                placeholder="Pilih tahun buku…"
                ariaLabel="Tahun buku"
                options={years.map((y) => ({
                  value: String(y.id),
                  label: y.name,
                  hint: y.closed ? "sudah ditutup" : undefined,
                }))}
              />
            </div>

            {!plan ? (
              <div className="empty sm">
                <div className="ic">
                  <Icon name="cal" size={20} />
                </div>
                <h4>
                  {years.length ? "Pilih tahun buku" : "Belum ada tahun buku Open"}
                </h4>
                <p>
                  {years.length
                    ? "Pilih tahun buku yang akan ditutup untuk Company ini."
                    : "Penutupan hanya berlaku untuk tahun buku yang sudah aktif. Aktifkan tahun buku lebih dahulu di Accounting › Fiscal Year."}
                </p>
              </div>
            ) : (
              <ChecklistCard plan={plan} />
            )}
          </div>

          {plan?.closed && <ClosedCard plan={plan} />}
          {plan?.preview && !plan.closed && (
            <PreviewCard plan={plan} preview={plan.preview} />
          )}
        </>
      )}

      {confirm && plan && (
        <ConfirmDialog
          open
          icon={transition.icon}
          tone="brand"
          title={transition.title}
          subject={`${plan.subject.companyLabel} · ${plan.subject.yearName}`}
          body={transition.body}
          confirmLabel={transition.confirmLabel}
          busy={busy}
          onConfirm={run}
          onCancel={() => setConfirm(false)}
        />
      )}
    </>
  );
}

/**
 * What is blocking, and what is not.
 *
 * Every condition is listed whether it passed or failed, because a checklist
 * that showed only problems would leave a reader unable to tell "nothing is
 * wrong" from "nothing has been checked" — and this is the screen where that
 * distinction is the whole question.
 */
function ChecklistCard({ plan }: { plan: ClosingPlan }) {
  const { subject, checks } = plan;
  const failed = checks.filter((c) => !c.ok).length;

  return (
    <>
      <div className="card-h">
        <span className={`ci mi sm ${failed ? "t-warn" : "t-ok"}`}>
          <Icon name={failed ? "warn" : "check"} size={16} />
        </span>
        <span className="ct">
          Syarat penutupan — {subject.companyLabel} · {subject.yearName}
        </span>
        <span className="bdg s-mute">
          {checks.length - failed}/{checks.length} terpenuhi
        </span>
      </div>

      <div className="tw">
        <table className="grid">
          <thead>
            <tr>
              <th style={{ width: 40 }} />
              <th style={{ width: 320 }}>Syarat</th>
              <th>Hasil pemeriksaan</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.key}>
                <td>
                  <span className={`mi sm ${c.ok ? "t-ok" : "t-bad"}`}>
                    <Icon name={c.ok ? "check" : "block"} size={14} />
                  </span>
                </td>
                <td className="pri">{c.label}</td>
                <td className="mut">{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** A close that has already happened, and what it produced. */
function ClosedCard({ plan }: { plan: ClosingPlan }) {
  const closed = plan.closed!;
  return (
    <div className="card">
      <div className="card-h">
        <span className="ci mi sm t-ok">
          <Icon name="lock" size={16} />
        </span>
        <span className="ct">Sudah ditutup</span>
      </div>
      <div className="empty sm">
        <div className="ic">
          <Icon name="lock" size={20} />
        </div>
        <h4>
          {plan.subject.companyLabel} menutup {plan.subject.yearName} pada{" "}
          {formatDate(closed.at)}
        </h4>
        <p>
          {closed.closingJournalId
            ? "Journal penutup dan Opening Balance tahun berikutnya sudah ditulis."
            : "Tahun buku ini tidak memiliki hasil untuk dipindahkan, sehingga tidak ada journal penutup."}{" "}
          Penutupan tidak dapat dibatalkan.
        </p>
        <div className="cta">
          {closed.closingJournalId && (
            <Link className="btn" href={`/accounting/journal/${closed.closingJournalId}`}>
              <Icon name="book" size={15} /> Lihat journal penutup
            </Link>
          )}
          {closed.openingBalanceId && (
            <Link
              className="btn"
              href={`/accounting/opening-balance/${closed.openingBalanceId}`}
            >
              <Icon name="file" size={15} /> Lihat Opening Balance
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The journal that is about to be written, in full.
 *
 * Nothing is summarised away. Every ProfitLoss balance is posted to the
 * opposite side of where it stands, which is what leaves it at zero, and the
 * residual lands on the equity account — so the two sides are equal by
 * construction and the totals row says so rather than being a hope.
 */
function PreviewCard({
  plan,
  preview,
}: {
  plan: ClosingPlan;
  preview: NonNullable<ClosingPlan["preview"]>;
}) {
  const { subject } = plan;

  if (!preview.lines.length) {
    return (
      <div className="card">
        <div className="card-h">
          <span className="ci mi sm t-brand">
            <Icon name="book" size={16} />
          </span>
          <span className="ct">Journal penutup</span>
        </div>
        <div className="empty sm">
          <div className="ic">
            <Icon name="book" size={20} />
          </div>
          <h4>Tidak ada hasil untuk dipindahkan</h4>
          <p>
            {subject.yearName} tidak memiliki saldo Pendapatan maupun Biaya pada
            Company ini, sehingga tidak ada journal penutup yang perlu ditulis.
            Opening Balance {subject.nextYearName ?? "tahun berikutnya"} tetap
            dibuat dari posisi neraca yang ada.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-h">
        <span className="ci mi sm t-brand">
          <Icon name="book" size={16} />
        </span>
        <span className="ct">
          Journal penutup — akan bertanggal {formatDate(subject.endDate)}
        </span>
        <span className={`bdg ${preview.result > 0 ? "t-slate" : "t-acc"}`}>
          {preview.result > 0 ? "Rugi" : preview.result < 0 ? "Laba" : "Impas"}{" "}
          {formatMoney(Math.abs(preview.result), BASE_CURRENCY_LABEL)}
        </span>
      </div>

      <div className="tw">
        <table className="grid">
          <thead>
            <tr>
              <th style={{ width: 132 }}>Account</th>
              <th>Nama Account</th>
              <th style={{ width: 130 }}>Partner</th>
              <th className="num" style={{ width: 150 }}>
                Debit
              </th>
              <th className="num" style={{ width: 150 }}>
                Kredit
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.lines.map((l) => (
              <tr key={`${l.accountId}:${l.partnerId ?? "-"}`}>
                <td>
                  <span className="lab">{l.accountLabel}</span>
                </td>
                <td className="pri">
                  {l.accountName}
                  {l.residual && (
                    <span className="rsub">
                      hasil {subject.yearName}, dipindahkan ke ekuitas
                    </span>
                  )}
                </td>
                <td className="mut">{l.partnerLabel ?? "—"}</td>
                <td className="num">
                  {l.debit ? formatMoney(l.debit, BASE_CURRENCY_LABEL) : "—"}
                </td>
                <td className="num">
                  {l.credit ? formatMoney(l.credit, BASE_CURRENCY_LABEL) : "—"}
                </td>
              </tr>
            ))}
            <tr className="totrow">
              <td colSpan={3}>Total — debit dan kredit seimbang</td>
              <td className="num">
                {formatMoney(preview.debit, BASE_CURRENCY_LABEL)}
              </td>
              <td className="num">
                {formatMoney(preview.credit, BASE_CURRENCY_LABEL)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="foot-note">
        Setelah diposting, Opening Balance {subject.nextYearName ?? "tahun berikutnya"}{" "}
        ditulis dengan {preview.snapshotLines} baris posisi neraca.
      </p>
    </div>
  );
}
