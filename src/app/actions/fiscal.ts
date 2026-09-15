"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { ensureFiscalPeriods, parseYear } from "@/lib/siba/fiscal";
import {
  FISCAL_YEAR_TRANSITIONS,
  transitionAllowed,
  type FiscalYearAction,
  type FiscalYearStatus,
} from "@/lib/siba/fiscal-workflow";

/**
 * The Fiscal Year lifecycle's one write path.
 *
 * Status is not an isian on the Fiscal Year form — it is `derived` and `locked`
 * in the registry, and `createRecord` pins a new year to Draft — so this is the
 * only way a year ever leaves Draft. The transition table in
 * `fiscal-workflow.ts` decides which move is legal from which status and which
 * permission it needs; the header buttons read the same table, so a hidden
 * button and a refused action cannot disagree.
 *
 * Activating is also what generates the twelve periods, in the same
 * transaction: a year that says Open and has no calendar behind it would let
 * Budget Month silently lose budgets (CLAUDE.md §10, rule 20).
 */
export type TransitionResult =
  | { ok: true; status: FiscalYearStatus; message: string; periods: number }
  | { ok: false; message: string };

export async function transitionFiscalYear(
  id: number,
  action: FiscalYearAction
): Promise<TransitionResult> {
  const transition = FISCAL_YEAR_TRANSITIONS[action];
  if (!transition) return { ok: false, message: "Aksi tidak dikenal." };

  let actorId: number;
  try {
    const actor = await authorizeAction(transition.permission);
    actorId = actor.user.id;
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, message: error.message };
    throw error;
  }

  const year = await prisma.accFiscalYear.findUnique({
    where: { id },
    select: { id: true, year_label: true, status: true },
  });
  if (!year) return { ok: false, message: "Tahun buku tidak ditemukan." };

  if (!transitionAllowed(action, year.status as FiscalYearStatus)) {
    return {
      ok: false,
      message: `Tahun buku berstatus ${year.status} tidak dapat ${transition.label.toLowerCase()}.`,
    };
  }

  const parsed = parseYear(year.year_label);
  if (!parsed) {
    return {
      ok: false,
      message: "Tahun buku ini tidak memiliki tahun yang valid, sehingga periodenya tidak dapat dibuat.",
    };
  }

  const periods = await prisma.$transaction(async (tx) => {
    await tx.accFiscalYear.update({
      where: { id },
      data: { status: transition.to, updated_by: actorId },
    });
    return ensureFiscalPeriods(tx, {
      fiscalYearId: id,
      year: parsed,
      actorId,
    });
  });

  await prisma.auditLog.create({
    data: {
      entity_key: "acc_fiscal_year",
      row_id: id,
      action: "UPDATE",
      by: actorId,
    },
  });

  revalidatePath("/accounting/fiscal-year");
  revalidatePath(`/accounting/fiscal-year/${id}`);
  revalidatePath("/budget/budget");
  revalidatePath("/dashboard");

  return { ok: true, status: transition.to, message: transition.done, periods };
}
