"use client";

import { createContext, useContext, type Context, type ReactNode } from "react";

/**
 * The id of the label of the `Field` a control sits in.
 *
 * A `<label htmlFor>` names only a native input, and most controls here are
 * not one — `Combobox` and `Select` are a `div role="combobox"`, `DateInput`
 * and `MoneyInput` are an input inside a box. Every shared control reads this
 * and points `aria-labelledby` at it, so a screen reader announces "Company"
 * rather than an unnamed combo box, without each call site passing an id.
 *
 * Created on first render rather than at import: the test suite imports
 * `MoneyInput` for its pure parsing functions under the `react-server`
 * condition, where `createContext` does not exist.
 */
let context: Context<string | undefined> | null = null;
function fieldLabelContext(): Context<string | undefined> {
  context ??= createContext<string | undefined>(undefined);
  return context;
}

export function FieldLabelProvider({ value, children }: { value: string; children: ReactNode }) {
  const Ctx = fieldLabelContext();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFieldLabelId(): string | undefined {
  return useContext(fieldLabelContext());
}
