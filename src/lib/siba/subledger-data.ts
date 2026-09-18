import "server-only";

import { prisma } from "@/lib/prisma";
import { type SubledgerDef, booksFrom } from "./subledger-catalogue";

/**
 * The subject books, read from the Budget Categories that keep them.
 *
 * Its own module rather than part of `subledger.ts` for the reason every book
 * in this application is a leaf: `sub_ledger` is an independent historical store
 * that imports only the shared kernel and its own catalogue, so the writer must
 * not also be the thing that reads `sys_budget_category`. Callers load the books
 * and hand them in.
 *
 * Ordered by the category's own id, so the toggle lists them in the order the
 * chart of classifications was built rather than alphabetically — which keeps
 * the original six in the order they were declared and puts a new one at the end.
 */
export async function loadSubledgers(): Promise<SubledgerDef[]> {
  const rows = await prisma.sysBudgetCategory.findMany({
    where: { status: "Active" },
    orderBy: { id: "asc" },
    select: {
      id: true,
      category_code: true,
      category_label: true,
      category_name: true,
      allows_in: true,
      allows_out: true,
      require_partner: true,
      raises: true,
      book_icon: true,
      book_closing_label: true,
    },
  });
  return booksFrom(rows);
}

/**
 * Every book a category has *ever* kept, including deactivated categories.
 *
 * A deactivated category stops being offered but its book still holds entries,
 * and a report or a rebuild asked for one must still be able to name it. This is
 * the subject-book counterpart of showing an inactive record in the picker that
 * already selected it.
 */
export async function loadSubledgersIncludingInactive(): Promise<SubledgerDef[]> {
  const rows = await prisma.sysBudgetCategory.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      category_code: true,
      category_label: true,
      category_name: true,
      allows_in: true,
      allows_out: true,
      require_partner: true,
      raises: true,
      book_icon: true,
      book_closing_label: true,
    },
  });
  return booksFrom(rows);
}
