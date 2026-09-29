import { Fragment } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";

/**
 * The page header of a document screen — list, new, view and edit alike.
 *
 * One implementation because every document had drawn its own, and they had
 * drifted: the module segment of the breadcrumb was a link on four screens and
 * plain text on the rest (a module has no page, §8), and one screen printed its
 * raw English status where every other read the Indonesian label. What a
 * document screen's header says is fixed by the convention, so it is fixed
 * here: breadcrumb, icon, the document's number in mono with its status badge
 * (or the placeholder before the first save), the Mode Ubah chip while editing,
 * and `.ph-act` — the unsaved chip first, then the actions, which the caller
 * orders through `orderForHeader`.
 *
 * A list passes `title` instead of a number and carries no status.
 */
export function DocumentHeader({
  module,
  trail = [],
  current,
  icon,
  title,
  number,
  placeholder,
  status,
  statusLabel,
  tags,
  editing,
  dirty,
  sub,
  children,
}: {
  /** The module's name — plain text, because a module has no page. */
  module: string;
  /**
   * The pages between the module and this one, each a link — the register a
   * document belongs to, or Budget Month and the month a Budget sits in.
   */
  trail?: { label: string; href: string }[];
  /** The breadcrumb's last segment, where it is not the number or the title. */
  current?: string;
  icon: IconName;
  /** A register's heading. */
  title?: string;
  /** The document's number, once it has one. */
  number?: string | null;
  /** What the heading reads before the first save — `Journal Manual Baru`. */
  placeholder?: string;
  /** The raw status; the label and the badge come from the one status map. */
  status?: string | null;
  /**
   * Where this document's status means something the shared map does not say —
   * a Funding Request that is `Open` is waiting on the induk. Rare by design.
   */
  statusLabel?: { text: string; tone: string };
  /** Further chips beside the status — what kind of document this is. */
  tags?: React.ReactNode;
  /** The edit page: states `Mode Ubah`. */
  editing?: boolean;
  /** Unsaved changes: states `Belum disimpan` beside the actions. */
  dirty?: boolean;
  /** A register's one-line description. Never on a form (§12). */
  sub?: string;
  /** The `.ph-act` buttons, already ordered danger → neutral → primary. */
  children?: React.ReactNode;
}) {
  const heading = title ?? number ?? placeholder ?? "";
  return (
    <div className="ph">
      <div className="crumb">
        <span>{module}</span>
        <span>/</span>
        {trail.map((t) => (
          <Fragment key={t.href + t.label}>
            <Link href={t.href}>{t.label}</Link>
            <span>/</span>
          </Fragment>
        ))}
        <span className="cur">{current ?? title ?? number ?? "Baru"}</span>
      </div>
      <div className="ph-row">
        <h1>
          <span className="ph-ico">
            <Icon name={icon} size={16} />
          </span>
          {number ? <span className="docno">{number}</span> : heading}
          {number && status && (
            <span className={`bdg ${statusLabel?.tone ?? STATUS_CLASS[status] ?? "s-mute"}`}>
              {statusLabel?.text ?? STATUS_TEXT[status] ?? status}
            </span>
          )}
          {tags}
          {editing && <span className="bdg t-warn">Mode Ubah</span>}
        </h1>
        <div className="ph-act">
          {dirty && (
            <span className="ph-dirty">
              <span className="pulse" /> Belum disimpan
            </span>
          )}
          {children}
        </div>
      </div>
      {sub && <p className="ph-sub">{sub}</p>}
    </div>
  );
}
