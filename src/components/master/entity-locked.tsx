import Link from "next/link";
import { Icon } from "@/components/icon";
import { COMPANY_LOCK_BODY, COMPANY_LOCK_HEADING } from "@/lib/siba/company";
import type { Entity } from "@/lib/siba/entities";

/**
 * Stands in for the create/edit form on an entity whose write path is locked.
 * The route stays reachable so a bookmarked or hand-typed URL explains itself
 * instead of 404-ing, but no form is rendered and no action is offered.
 */
export function EntityLocked({
  entity,
  mode,
  subject,
  backHref,
}: {
  entity: Entity;
  mode: "new" | "edit";
  /** Label – Name of the record being edited, when there is one. */
  subject?: string;
  backHref: string;
}) {
  const basePath = `/${entity.module}/${entity.slug}`;

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <Link href="/dashboard">Master</Link>
          <span>/</span>
          <Link href={basePath}>{entity.name}</Link>
          <span>/</span>
          <span className="cur">{mode === "new" ? "Baru" : (subject ?? "Ubah")}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name={entity.icon} size={16} />
            </span>
            {mode === "new" ? `Tambah ${entity.single ?? entity.name}` : (subject ?? entity.name)}
            <span className="bdg s-mute">
              <Icon name="lock" size={11} /> Terkunci
            </span>
          </h1>
        </div>
        <p className="ph-sub">{entity.desc}</p>
      </div>

      <div className="card">
        <div className="empty">
          <div className="ic">
            <Icon name="lock" size={20} />
          </div>
          <h4>{COMPANY_LOCK_HEADING}</h4>
          <p>{COMPANY_LOCK_BODY}</p>
          <div className="cta">
            <Link className="btn" href={backHref}>
              <Icon name="back" size={15} /> Kembali
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
