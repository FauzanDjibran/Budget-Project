import Link from "next/link";
import { Icon } from "@/components/icon";

/**
 * What a signed-in user sees when they reach something they may not use.
 *
 * Deliberately vague about the cause: it names neither the permission code nor
 * whether the record exists. The user keeps their session — this is a refusal,
 * not a sign-out.
 */
export function AccessDenied({
  title = "Akses ditolak",
  body = "Anda tidak memiliki akses ke halaman ini. Hubungi administrator jika Anda memerlukannya.",
  backHref = "/",
}: {
  title?: string;
  body?: string;
  backHref?: string;
}) {
  return (
    <>
      <div className="ph">
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="lock" size={16} />
            </span>
            {title}
          </h1>
        </div>
      </div>

      <div className="card">
        <div className="empty">
          <div className="ic" style={{ background: "var(--bad-bg)", color: "var(--bad)" }}>
            <Icon name="lock" size={20} />
          </div>
          <h4>{title}</h4>
          <p>{body}</p>
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
