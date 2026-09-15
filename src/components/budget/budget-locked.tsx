import Link from "next/link";
import { Icon } from "@/components/icon";
import { STATUS_TEXT } from "@/lib/siba/entities";
import type { BudgetRow } from "@/lib/siba/budget";

/**
 * Stands in for the edit form once a budget has left Draft or Rejected.
 *
 * The route stays reachable so a bookmarked or hand-typed URL explains itself
 * rather than 404-ing. It is not the protection — `updateBudget` refuses the
 * same write on its own.
 */
export function BudgetLocked({ budget }: { budget: BudgetRow }) {
  const status = STATUS_TEXT[budget.status] ?? budget.status;

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <Link href="/dashboard">Budget</Link>
          <span>/</span>
          <Link href="/budget/budget">Budget Month</Link>
          <span>/</span>
          <Link href={`/budget/budget/${budget.id}`}>{budget.budget_no}</Link>
          <span>/</span>
          <span className="cur">Ubah</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clip" size={16} />
            </span>
            {budget.description}
            <span className="bdg s-mute">
              <Icon name="lock" size={11} /> Terkunci
            </span>
          </h1>
        </div>
      </div>

      <div className="card">
        <div className="empty">
          <div className="ic">
            <Icon name="lock" size={20} />
          </div>
          <h4>Budget ini tidak dapat diubah</h4>
          <p>
            Budget hanya dapat diubah selama berstatus Draft atau Ditolak.
            Budget ini berstatus <b>{status}</b>. Budget yang sudah diajukan
            tidak boleh berubah di bawah approver, dan budget yang sudah
            disetujui bersifat final agar realisasinya dapat ditelusuri.
          </p>
          <div className="cta">
            <Link className="btn" href={`/budget/budget/${budget.id}`}>
              <Icon name="back" size={15} /> Kembali ke detail
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
