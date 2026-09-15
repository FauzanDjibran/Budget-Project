/**
 * The headline figures of one report block, labels above numbers.
 *
 * Every Report View states its block totals this way, which is the one place
 * the four reports had drifted apart: a summary written as
 * `Awal Rp 0 · D Rp 0 · K Rp 200.000 · Akhir Rp -200.000` holds the right
 * numbers and none of them can be read at a glance, because the labels and the
 * values sit on the same line in the same weight. Stacking the label over the
 * value, right-aligned and monospaced, is what makes a strip of figures
 * scannable.
 *
 * `key` marks the figure a reader looks for first — the closing balance — and
 * is set larger. `neg` colours a figure that has gone the wrong way; `zero`
 * fades one that never moved, so the numbers that did carry the eye.
 *
 * Plain markup with no imports, so a server component and a client component
 * can both render it.
 */
export type ReportFigure = {
  label: string;
  value: string;
  /** The figure read first — rendered larger. */
  key?: boolean;
  /** Below zero, and worth saying so. */
  negative?: boolean;
  /** Never moved — faded rather than dropped, so the columns still line up. */
  zero?: boolean;
};

export function ReportSummary({ figures }: { figures: ReportFigure[] }) {
  return (
    <span className="rsum">
      {figures.map((f) => (
        <span
          key={f.label}
          className={
            [f.key ? "k" : "", f.negative ? "neg" : "", f.zero ? "z" : ""]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          <i>{f.label}</i>
          <b>{f.value}</b>
        </span>
      ))}
    </span>
  );
}
