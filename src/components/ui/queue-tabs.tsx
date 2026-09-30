"use client";

/**
 * Status tabs over a register — one tab per status, each with its count.
 *
 * A tab narrows the list to rows that share one status, which is what makes a
 * bulk action safe: every row selected inside it allows the same transitions.
 * The count is the work waiting there. `.qtabs` is drawn here and nowhere else.
 */
export function QueueTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: string; label: string; count: number }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="qtabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          className={t.value === value ? "act" : undefined}
          onClick={() => onChange(t.value)}
        >
          {t.label}
          <span className="n">{t.count}</span>
        </button>
      ))}
    </div>
  );
}
