"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/siba/entities";
import type { RoleRow } from "@/lib/siba/user-admin";

/**
 * The role register. A role's worth is its permission count and how many people
 * hold it, so both are columns rather than something to drill into.
 */
export function RoleList({
  roles,
  totalPermissions,
  canCreate,
}: {
  roles: RoleRow[];
  totalPermissions: number;
  canCreate: boolean;
}) {
  const router = useRouter();

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Pengaturan</span>
          <span>/</span>
          <span className="cur">Role</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="tags" size={16} />
            </span>
            Role
          </h1>
          <div className="ph-act">
            {canCreate && (
              <Link className="btn primary" href="/settings/role/new">
                <Icon name="plus" size={15} /> Tambah Role
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Role adalah kumpulan permission, dan satu-satunya jalur pemberian akses
          kepada user. Menonaktifkan Role mencabut aksesnya dari semua pemegangnya
          tanpa mengubah satu pun penugasan.
        </p>
      </div>

      <div className="card">
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 38 }}>No</th>
                <th style={{ width: 120 }}>Kode</th>
                <th style={{ width: 150 }}>Label</th>
                <th>Nama Role</th>
                <th className="num" style={{ width: 120 }}>
                  Permission
                </th>
                <th className="num" style={{ width: 86 }}>
                  User
                </th>
                <th style={{ width: 112 }}>Status</th>
                <th style={{ width: 54 }} />
              </tr>
            </thead>
            <tbody>
              {roles.map((r, i) => (
                <tr key={r.id} onClick={() => router.push(`/settings/role/${r.id}`)}>
                  <td className="no">{i + 1}</td>
                  <td className="mut mono">{r.role_code}</td>
                  <td>
                    <span className="lab">{r.role_label}</span>
                  </td>
                  <td className="pri">
                    {r.role_name}
                    {r.is_system && (
                      <span className="bdg s-info" style={{ marginLeft: 6 }}>
                        Bawaan
                      </span>
                    )}
                  </td>
                  <td className="num">
                    {r.permission_codes.length} / {totalPermissions}
                  </td>
                  <td className="num">{r.user_count}</td>
                  <td>
                    <span className={`bdg ${STATUS_CLASS[r.status] ?? "s-mute"}`}>
                      {STATUS_TEXT[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="acts">
                    <span className="ract">
                      <button
                        className="iact"
                        title="Lihat detail"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/settings/role/${r.id}`);
                        }}
                      >
                        <Icon name="eye" size={15} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
