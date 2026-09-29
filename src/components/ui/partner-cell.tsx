import type { PartnerMismatch } from "@/lib/siba/journal";

/**
 * The Partner of one journal line — on the Journal and in the General Ledger.
 *
 * Shows what the line recorded, as a code chip and a name, and a dash where it
 * recorded none. Only an account that requires a Partner may carry one, and
 * every line on such an account must, so a line that breaks either half says
 * so beneath the cell: a system fault is stated on the line it is in, not left
 * for a reader to notice.
 */
export function PartnerCell({
  label,
  name,
  mismatch,
}: {
  label: string | null;
  name: string | null;
  mismatch: PartnerMismatch | null;
}) {
  return (
    <>
      {label ? (
        <span className="idc" title={name ? `${label} — ${name}` : label}>
          <span className="lab">{label}</span>
          {name && <span className="nm">{name}</span>}
        </span>
      ) : (
        <span className="dash">—</span>
      )}
      {mismatch && (
        <span
          className="overtag"
          title={
            mismatch === "missing"
              ? "Account ini mewajibkan Partner, tetapi baris journal ini tidak mencatatnya."
              : "Account ini tidak memakai Partner, tetapi baris journal ini mencatatnya."
          }
        >
          {mismatch === "missing" ? "tanpa Partner" : "account tanpa Partner"}
        </span>
      )}
    </>
  );
}
