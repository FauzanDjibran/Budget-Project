"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icon";
import { Select } from "@/components/ui/select";

/**
 * Which Company's records a page is showing.
 *
 * Lives on the page rather than in the topbar, because the question only
 * arises on the screens where it is genuinely ambiguous — a chart of accounts
 * and a partner list belong to one Company, and both Companies' worth at once
 * reads as duplicated rows. Screens that are not Company-scoped never show it.
 *
 * The choice is a `?company=` search parameter, so a run is linkable and the
 * back button works, and so the Server Component can read it and query for
 * that Company alone. The options are only the Companies the user's
 * permissions open; a user who may see one never sees the control at all,
 * because a picker with one option is not a choice.
 */
export function CompanyFilter({
  options,
  selectedId,
}: {
  options: { id: number; label: string; name: string }[];
  selectedId: number;
}) {
  const router = useRouter();
  const params = useSearchParams();

  if (options.length < 2) return null;

  const onChange = (value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("company", value);
    router.push(`?${next.toString()}`);
  };

  return (
    <Select
      variant="toolbar"
      value={String(selectedId)}
      onChange={onChange}
      title="Company pemilik data"
      ariaLabel="Company"
      options={options.map((c) => ({
        value: String(c.id),
        label: `${c.label} - ${c.name}`,
      }))}
    />
  );
}

/**
 * What a page shows when a user holds neither Company permission. An empty
 * table would read as "no data yet", which is a different and misleading
 * thing: the records exist, this account simply may not see them.
 */
export function NoCompanyAccess({ what }: { what: string }) {
  return (
    <div className="empty">
      <div className="ic">
        <Icon name="lock" size={20} />
      </div>
      <h4>Tidak ada akses Company</h4>
      <p>
        {what} dimiliki oleh sebuah Company, dan akun Anda belum diberi akses ke
        Company mana pun. Hubungi administrator untuk meminta akses.
      </p>
    </div>
  );
}
