import type { ReactNode } from "react";
import { Icon } from "@/components/icon";

/**
 * The form primitives.
 *
 * Every form in the application hand-wrote its own `<div className="fld">`
 * block, and three of them carried a private copy of the same `Foot()` —
 * label, required star, lock badge, help, error. Eleven files therefore had to
 * be edited in step to change anything about how a field is laid out, which is
 * the drift a repeated control is supposed to stop (CLAUDE.md §12).
 *
 * `Field` is that one implementation. The help text sits on the label row
 * rather than under the control: it is the single largest vertical cost in a
 * form (21px per field for a 34px control) and the one part of the field that
 * has no height of its own to give up.
 *
 * A field declares how much of the row it wants rather than being pinned to
 * half of it, so a date picker can take a quarter and a description the whole
 * width. Twelve columns is what makes that expressible; half is the default, so
 * a form that says nothing reads the way every form used to.
 */

/** Twelfths of the row. 6 is half, the shape every form had before. */
export type FieldSpan = 3 | 4 | 5 | 6 | 8 | 12;

export function FormSection({
  title,
  hint,
  children,
}: {
  /** Omitted when the card holds a single section and would only repeat itself. */
  title?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="fsec">
      {title && (
        <div className="sec-t">
          {title}
          {hint && <span className="h">{hint}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export function FormRow({ children }: { children: ReactNode }) {
  return <div className="frow">{children}</div>;
}

/** The body of a card that holds form sections: the row pays the padding. */
export function FormBody({ children }: { children: ReactNode }) {
  return <div className="card-b fbody">{children}</div>;
}

export function Field({
  label,
  span = 6,
  required,
  locked,
  help,
  error,
  htmlFor,
  children,
}: {
  label: string;
  span?: FieldSpan;
  /** The control's id, where it has one, so the label is clickable. */
  htmlFor?: string;
  required?: boolean;
  /** Immutable once the record exists — shown as a badge, never a disabled input. */
  locked?: boolean;
  /**
   * One clause, not a paragraph. It shares the label's line, so a column too
   * narrow for it shows as much as fits and keeps the rest in `title`.
   */
  help?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={`fld f-${span}${span === 12 ? " full" : ""}`}>
      <label htmlFor={htmlFor}>
        <span className="lt">{label}</span>
        {required && <span className="req">*</span>}
        {locked && <span className="lockb">Terkunci</span>}
        {/* An error replaces the help rather than stacking under it: the form
            grows by one line only when something is actually wrong. */}
        {help && !error && (
          <span className="lh" title={help}>
            {help}
          </span>
        )}
      </label>
      {children}
      {error && (
        <div className="err">
          <Icon name="warn" size={11} />
          {error}
        </div>
      )}
    </div>
  );
}
