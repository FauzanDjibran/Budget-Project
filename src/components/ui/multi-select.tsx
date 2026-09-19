"use client";

import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import type { RefOption } from "@/lib/siba/records";

/**
 * Several of something, chosen one at a time.
 *
 * A searchable `Combobox` that adds, and a row of chips that remove. It is the
 * shape a set wants once the list it is drawn from can grow: a checkbox grid
 * states every option whether or not anyone will ever pick it, so it costs
 * vertical space in proportion to the catalogue rather than to the answer, and
 * stops being scannable the moment the catalogue is long. This costs one line
 * plus one chip per choice, and it is searchable, which a grid is not.
 *
 * The picker only ever offers what is **not** already chosen, so the same
 * option cannot be added twice and the list shortens as the answer grows.
 *
 * It renders the two pieces and nothing around them — no label, no field
 * wrapper — because it is used both inside a form `Field` and inside a report's
 * filter bar, which supply their own chrome.
 */
export function MultiSelect({
  value,
  options,
  placeholder,
  emptyPlaceholder,
  clearLabel = "Bersihkan",
  removeTitle,
  invalid,
  disabled,
  waitingFor,
  onChange,
}: {
  /** Ids currently chosen, in the order they should read. */
  value: number[];
  options: RefOption[];
  /** Prompt while something is already chosen — `Tambah <what>…`. */
  placeholder: string;
  /** Prompt while nothing is — `Pilih <what>…`, the shape every prompt uses. */
  emptyPlaceholder?: string;
  clearLabel?: string;
  removeTitle?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Shown in place of the prompt while a prerequisite is unanswered. */
  waitingFor?: string | null;
  onChange: (ids: number[]) => void;
}) {
  const chosen = new Set(value);
  const remaining = options.filter((o) => !chosen.has(o.id));
  const byId = new Map(options.map((o) => [o.id, o]));

  const add = (id: string | number | null) => {
    const next = Number(id);
    if (!Number.isInteger(next) || next <= 0 || chosen.has(next)) return;
    onChange([...value, next]);
  };
  const remove = (id: number) => onChange(value.filter((x) => x !== id));

  return (
    <>
      <Combobox
        value={null}
        options={remaining}
        placeholder={value.length ? placeholder : emptyPlaceholder ?? placeholder}
        invalid={invalid}
        // Nothing left to add is not an error and not a prerequisite — the
        // answer is simply complete, so the picker says so rather than opening
        // onto an empty list.
        disabled={disabled || (!remaining.length && !waitingFor)}
        waitingFor={waitingFor}
        onChange={add}
      />

      {value.length > 0 && (
        <div className="rchips">
          {value.map((id) => (
            <button
              key={id}
              type="button"
              className="rchip"
              title={removeTitle}
              disabled={disabled}
              onClick={() => remove(id)}
            >
              {byId.get(id)?.label ?? id}
              <Icon name="block" size={10} />
            </button>
          ))}
          {value.length > 1 && !disabled && (
            <button type="button" className="lnk" onClick={() => onChange([])}>
              {clearLabel}
            </button>
          )}
        </div>
      )}
    </>
  );
}
