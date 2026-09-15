"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import type { RefOption } from "@/lib/siba/records";
import { reportHref } from "@/lib/siba/reports";

/**
 * The parameter bar for the `account-period` set: **several** accounts plus an
 * inclusive date range.
 *
 * Several, because reading a ledger nearly always means reading a pair — the
 * cash account against whatever it moved against — and making that two page
 * loads is what makes checking the books tedious. The accounts go into the URL
 * as `accounts=3,17,42`, so a run of four accounts is still one link.
 *
 * Chosen accounts are listed as removable chips rather than staying inside the
 * picker: a Combobox shows one value, and the whole point here is seeing the
 * set. The picker keeps offering the accounts not yet chosen.
 */
export function AccountParams({
  slug,
  accounts,
  selectedIds,
  from,
  to,
  subjectRequired,
  companyId,
}: {
  slug: string;
  accounts: RefOption[];
  selectedIds: number[];
  from: string;
  to: string;
  subjectRequired: boolean;
  /** Carried through the URL so switching Company does not lose the run. */
  companyId: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [selected, setSelected] = useState<number[]>(selectedIds);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);

  const invalidRange = Boolean(start && end && start > end);
  const missingSubject = subjectRequired && selected.length === 0;

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const remaining = accounts.filter((a) => !selected.includes(a.id));

  const add = (id: number | null) => {
    if (id == null || selected.includes(id)) return;
    setSelected((s) => [...s, id]);
  };
  const remove = (id: number) => setSelected((s) => s.filter((x) => x !== id));

  const run = () => {
    if (invalidRange || missingSubject) return;
    startTransition(() => {
      router.push(
        reportHref(slug, {
          company: companyId,
          accounts: selected.join(","),
          from: start,
          to: end,
        })
      );
    });
  };

  return (
    <>
      <span className="count" style={{ marginRight: 2 }}>
        Account
      </span>

      <div style={{ minWidth: 250, flex: "0 1 320px" }}>
        <Combobox
          value={null}
          options={remaining}
          placeholder={
            subjectRequired ? "Tambah account…" : "Semua account yang bergerak"
          }
          onChange={add}
        />
      </div>

      <span className="count">Periode</span>

      <div style={{ width: 138 }}>
        <DateInput value={start} invalid={invalidRange} onChange={setStart} />
      </div>
      <span className="count">s/d</span>
      <div style={{ width: 138 }}>
        <DateInput value={end} invalid={invalidRange} onChange={setEnd} />
      </div>

      <button
        className="btn primary sm"
        onClick={run}
        disabled={pending || invalidRange || missingSubject}
        title={
          invalidRange
            ? "Tanggal akhir tidak boleh lebih awal dari tanggal mulai."
            : missingSubject
              ? "Pilih minimal satu account terlebih dahulu."
              : undefined
        }
      >
        <Icon name="srch" size={14} /> Tampilkan
      </button>

      {invalidRange && (
        <span className="err" style={{ marginLeft: 2 }}>
          <Icon name="warn" size={11} />
          Tanggal akhir lebih awal dari tanggal mulai.
        </span>
      )}

      {selected.length > 0 && (
        <div className="tspace" style={{ flexBasis: "100%", height: 0 }} />
      )}

      {selected.map((id) => (
        <button
          key={id}
          className="bdg t-acc"
          title="Keluarkan dari laporan"
          onClick={() => remove(id)}
        >
          {byId.get(id)?.label ?? id}
          <Icon name="block" size={10} />
        </button>
      ))}

      {selected.length > 1 && (
        <button className="btn sm" onClick={() => setSelected([])}>
          Bersihkan
        </button>
      )}

      <div className="tspace" />
    </>
  );
}
