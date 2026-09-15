"use client";

import { Icon } from "@/components/icon";

/**
 * The search box in a list toolbar.
 *
 * Every list in the application filters the same way — an icon on the left, a
 * clear button that appears once there is something to clear, `Cari …` as the
 * prompt — and this is the one implementation of it. Seven lists used to carry
 * their own copy of the markup, which is how a control ends up behaving
 * slightly differently on the screen a user happens to be on.
 *
 * `grow` is for a toolbar where search is the only control and should take the
 * width; the default width is what sits comfortably beside a Company picker.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  grow,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Always phrased `Cari <what>…`, so the prompt says what is being searched. */
  placeholder: string;
  grow?: boolean;
}) {
  return (
    <div className={`srch${value ? " has" : ""}${grow ? " grow" : ""}`}>
      <Icon name="srch" size={14} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      <button className="x" onClick={() => onChange("")} aria-label="Bersihkan">
        <Icon name="block" size={13} />
      </button>
    </div>
  );
}
