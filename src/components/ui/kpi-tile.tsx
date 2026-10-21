import { Icon, type IconName } from "@/components/icon";

/**
 * A summary tile: an icon, a label, the figure, a line of detail. Pressing it
 * does the one thing it offers — opens its Rincian, or narrows the list below.
 *
 * `lines` states one figure per currency, each on a line of its own, for a
 * total that spans currencies and so is never one number (CLAUDE.md §9).
 */
export function KpiTile({
  icon,
  tone,
  label,
  more,
  wide,
  value,
  lines,
  detail,
  onClick,
}: {
  icon: IconName;
  tone: "t-ok" | "t-warn" | "t-info" | "t-acc" | "t-vio" | "t-bad";
  label: string;
  /** The hint at the top right — `Rincian` where pressing opens one. */
  more?: string;
  wide?: boolean;
  value?: React.ReactNode;
  lines?: React.ReactNode[];
  detail?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`kpi${wide ? " wide" : ""}`} onClick={onClick}>
      <div className="h">
        <span className={`i ${tone}`}>
          <Icon name={icon} size={14} />
        </span>
        <span className="l">{label}</span>
        {more && (
          <span className="more">
            {more} <Icon name="chev" size={11} />
          </span>
        )}
      </div>
      {lines ? (
        <div className="v stack">
          {lines.length ? lines.map((l, i) => <span key={i}>{l}</span>) : <span>—</span>}
        </div>
      ) : (
        <div className="v">{value}</div>
      )}
      {detail && <div className="d">{detail}</div>}
    </button>
  );
}
