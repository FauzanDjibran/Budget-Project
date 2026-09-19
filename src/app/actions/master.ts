"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { type Actor } from "@/lib/siba/access";
import { authorizeAction } from "@/lib/siba/auth";
import { isAccessDenied } from "@/lib/siba/auth-errors";
import { entityPermissions } from "@/lib/siba/entity-access";
import {
  COMPANY_CREATE_BLOCKED,
  COMPANY_UPDATE_BLOCKED,
  isCompanyEntity,
} from "@/lib/siba/company";
import { type Entity, type Field } from "@/lib/siba/entities";
import {
  SEGMENT_RANGE_TEXT,
  joinCode,
  parseSegment,
} from "@/lib/siba/account-code";
import { openCashBankBook } from "@/lib/siba/cash-bank";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "@/lib/siba/currency";
import { fiscalYearShape, parseYear } from "@/lib/siba/fiscal";
import {
  CASH_BANK_SUBCATEGORY,
  accountDescendants,
  accountUsage,
  checkAccountIsLeaf,
  checkAccountNumber,
  checkCashBankAccount,
  delegate,
  nextCode,
  partnerCategoriesForBudgetCategory,
  refLabel,
  reconcileMultiref,
  requireEntity,
  strandedCategories,
  syncControlAccounts,
} from "@/lib/siba/records";
import { loadClassification } from "@/lib/siba/classification-data";
import { directionText } from "@/lib/siba/classification";
import {
  systemDefaultAccountIds,
  systemDefaultsUsingAccount,
} from "@/lib/siba/system-settings";

/**
 * Every action here is permission-gated before it touches anything, and every
 * write is attributed to the signed-in user. A Server Action is reachable
 * directly, so the check below — not the hidden button in the list — is what
 * actually stops an unauthorized write.
 *
 * The same holds for the business rules in `validate`: a picker that offers
 * only valid options is a convenience. The rules are enforced here.
 */

export type FormValues = Record<string, string | boolean | null>;

/**
 * `errors` is keyed by field name, except for `_form` — a whole-form refusal
 * that no single field can carry, such as a locked entity.
 */
export type SaveResult =
  | { ok: true; id: number; code?: string }
  | { ok: false; errors: Record<string, string> };

type Guard =
  | { ok: true; actor: Actor }
  | { ok: false; denial: { ok: false; errors: Record<string, string> } };

/**
 * Resolves the caller and checks the one permission this operation needs.
 *
 * Refusals come back as a `_form` error rather than an exception, so the form
 * shows them the same way it shows a validation failure. The message never
 * names the permission code.
 */
async function authorize(
  entityKey: string,
  operation: "create" | "edit" | "activate" | "deactivate"
): Promise<Guard> {
  const code = entityPermissions(entityKey)[operation];
  if (!code) {
    return { ok: false, denial: { ok: false, errors: { _form: "Operasi tidak tersedia." } } };
  }
  try {
    return { ok: true, actor: await authorizeAction(code) };
  } catch (error) {
    if (isAccessDenied(error)) {
      return { ok: false, denial: { ok: false, errors: { _form: error.message } } };
    }
    throw error;
  }
}

/**
 * Coerces a submitted value to what Prisma expects for the field's type.
 * Empty string means "not filled" for every type except text/textarea.
 */
function coerce(field: Field, raw: string | boolean | null | undefined) {
  if (field.type === "bool") return raw === true || raw === "true";
  // A segment is virtual — only the code composed from it is ever stored — so
  // it stays the text that was typed, and `parseSegment` is what judges it.
  if (field.type === "segment") return raw == null ? "" : String(raw).trim();

  const value = raw == null ? "" : String(raw).trim();

  if (
    field.type === "ref" ||
    field.type === "number" ||
    field.type === "money" ||
    field.type === "rate"
  ) {
    if (value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (field.type === "select") return value === "" ? null : value;
  if (field.type === "date") return value === "" ? null : new Date(`${value}T00:00:00Z`);
  return value;
}

/** A numeric field's value, or null when it was blank or unparseable. */
const numberValue = (values: FormValues, name: string): number | null => {
  const raw = values[name];
  if (raw == null || raw === "" || raw === true || raw === false) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** A ref field carries a row id, which is a number like any other. */
const refValue = numberValue;

const boolValue = (values: FormValues, name: string): boolean =>
  values[name] === true || values[name] === "true";


/**
 * Fills in the fields nobody types.
 *
 * A Fiscal Year is chosen by year alone; its name and its 01/01–31/12 range
 * follow from that and are written here rather than submitted, so a crafted
 * request cannot put a fiscal year's dates out of step with the year it claims
 * to be. Runs before validation, so the derived values are what gets checked.
 *
 * Its status is pinned to Draft for the same reason. A fiscal year is created
 * as Draft and moves on only through `transitionFiscalYear` — the field is
 * locked, so an update drops it, and a create writes Draft whatever was sent.
 *
 * An account's number is derived the same way, from its place in the chart
 * rather than from what was typed: the form offers one segment, and the whole
 * code is composed here. A submitted `account_label` is therefore ignored,
 * which is what makes a code that contradicts its own lineage unreachable.
 */
async function derive(entity: Entity, values: FormValues): Promise<FormValues> {
  if (entity.key === "acc_fiscal_year") {
    const year = parseYear(String(values.year_label ?? ""));
    if (!year) return { ...values, status: "Draft" };

    const shape = fiscalYearShape(year);
    return {
      ...values,
      status: "Draft",
      year_name: shape.year_name,
      start_date: shape.start_date.toISOString().slice(0, 10),
      end_date: shape.end_date.toISOString().slice(0, 10),
    };
  }

  return composeSegmentCode(entity, values);
}

/**
 * Writes the full code for a `segment` field: the code of whatever the record
 * hangs under, plus the one number that was typed.
 *
 * Driven entirely by the field's own `inheritsFrom` / `writesTo`, so a second
 * entity that numbers itself this way is config rather than another branch.
 * When either half is missing the values are returned untouched and
 * `validate` reports it — composing half a code would be worse than none.
 */
async function composeSegmentCode(
  entity: Entity,
  values: FormValues
): Promise<FormValues> {
  const field = entity.fields.find((f) => f.type === "segment");
  if (!field?.writesTo) return values;

  const segment = parseSegment(values[field.name]);
  if (segment == null) return values;

  const prefix = await inheritedCode(entity, field, values);
  if (!prefix) return values;

  return { ...values, [field.writesTo]: joinCode(prefix, segment) };
}

/** The code a segment continues — the first `inheritsFrom` field that is set. */
async function inheritedCode(
  entity: Entity,
  field: Field,
  values: FormValues
): Promise<string | null> {
  for (const name of field.inheritsFrom ?? []) {
    const id = refValue(values, name);
    if (!id) continue;
    const source = entity.fields.find((f) => f.name === name);
    if (!source?.ref) continue;
    return refLabel(source.ref, id);
  }
  return null;
}

/**
 * Which fields apply given what has been entered. A field that does not apply
 * is not merely hidden: it is stored as null and its `required` is waived. The
 * form hides the same fields, but this is the decision that counts.
 */
async function applicableFields(
  entity: Entity,
  values: FormValues,
  exists: boolean
): Promise<Set<string>> {
  const applies = new Set<string>();
  let budgetCategoryNeedsPartner: boolean | null = null;

  for (const field of entity.fields) {
    // A create-only field is not merely hidden on edit: it is not part of the
    // submission at all, so an edit cannot smuggle one in.
    if (field.createOnly && exists) continue;
    if (!field.visibleWhen) {
      applies.add(field.name);
      continue;
    }
    if (field.visibleWhen === "accountRequiresPartner") {
      if (boolValue(values, "require_partner")) applies.add(field.name);
      continue;
    }
    if (field.visibleWhen === "categoryChoosesRaises") {
      // Only a category that keeps a book and moves both ways has a choice to
      // make; a single-direction one has its answer derived below.
      if (boolValue(values, "require_partner") && values.direction_mode === "Both") {
        applies.add(field.name);
      }
      continue;
    }
    if (field.visibleWhen === "currencyIsForeign") {
      const currencyId = refValue(values, "currency_id");
      const label = currencyId ? await refLabel("ref_currency", currencyId) : null;
      if (label && !isBaseCurrency(label)) applies.add(field.name);
      continue;
    }
    if (budgetCategoryNeedsPartner === null) {
      const categoryId = refValue(values, "budget_category_id");
      const rule = categoryId
        ? await partnerCategoriesForBudgetCategory(categoryId)
        : null;
      budgetCategoryNeedsPartner = rule?.needsPartner ?? false;
    }
    if (budgetCategoryNeedsPartner) applies.add(field.name);
  }
  return applies;
}

async function validate(
  entity: Entity,
  values: FormValues,
  currentId: number | null,
  applies: Set<string>
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};

  for (const field of entity.fields) {
    if (!applies.has(field.name)) continue;
    const value = coerce(field, values[field.name]);

    if (field.required) {
      const missing = value === null || value === undefined || value === "";
      if (missing) errors[field.name] = `${field.label} wajib diisi.`;
    }

    if (field.unique && typeof value === "string" && value !== "") {
      // Scoped uniqueness where the identity is only unique within a parent —
      // an account number is unique per Company, not across the whole table.
      const scope = field.uniqueWithin
        ? { [field.uniqueWithin]: refValue(values, field.uniqueWithin) }
        : {};
      const clash = await delegate(entity.key).findFirst({
        where: {
          [field.name]: { equals: value, mode: "insensitive" },
          ...scope,
          ...(currentId ? { id: { not: currentId } } : {}),
        },
        select: { id: true },
      });
      if (clash) {
        errors[field.name] = field.uniqueWithin
          ? `${field.label} "${value}" sudah dipakai pada Company yang sama.`
          : `${field.label} "${value}" sudah dipakai record lain.`;
      }
    }
  }

  // Company has no write path, so there is no single-parent rule to validate
  // here — the invariant is asserted against what is in the database instead, by
  // `companyStructure()` in records.ts.

  if (entity.key === "m_cash_bank") {
    Object.assign(errors, await validateCashBank(values, errors));
  }
  if (entity.key === "acc_account") {
    Object.assign(errors, await validateAccount(values, currentId, errors, applies));
  }
  if (entity.key === "acc_budget_category_account") {
    Object.assign(errors, await validateMapping(values, currentId, errors, applies));
  }
  if (entity.key === "sys_budget_category") {
    Object.assign(errors, validateBudgetCategory(values));
  }
  if (entity.key === "sys_purpose") {
    Object.assign(errors, await validatePurpose(values, currentId, errors));
  }
  if (entity.key === "acc_fiscal_year" && !parseYear(String(values.year_label ?? ""))) {
    // Everything else about a fiscal year is derived from this, so a value the
    // picker could not have produced has to stop here.
    errors.year_label = "Pilih tahun buku yang valid.";
  }

  return errors;
}

/**
 * A Cash & Bank resource posts to exactly one account, and that account must be
 * one the resource can legitimately use: owned by the same Company, postable,
 * in the Kas or Bank group, and active.
 */
async function validateCashBank(
  values: FormValues,
  existing: Record<string, string>
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};

  // An opening balance becomes the resource's first book entry, and for a
  // foreign resource its first rate layer as well. The currency it starts with
  // was acquired at some price, and that price is what a later payment out of
  // it releases — so the kurs is required rather than assumed. A base-currency
  // resource needs none: rupiah is already the measure.
  const openingBalance = numberValue(values, "opening_balance") ?? 0;
  const openingRate = numberValue(values, "opening_rate");
  if (openingBalance) {
    const currencyId = refValue(values, "currency_id");
    const currency = currencyId
      ? await prisma.refCurrency.findUnique({
          where: { id: currencyId },
          select: { currency_label: true },
        })
      : null;
    if (currency && !isBaseCurrency(currency.currency_label)) {
      if (!openingRate || openingRate <= 0) {
        errors.opening_rate =
          `Isi kurs perolehan saldo awal — berapa nilai 1 ${currency.currency_label} ` +
          `dalam ${BASE_CURRENCY_LABEL} saat saldo itu diperoleh.`;
      }
    }
  }

  if (existing.company_id || existing.account_id) return errors;
  const companyId = refValue(values, "company_id");
  const accountId = refValue(values, "account_id");
  if (!companyId || !accountId) return errors;

  const problem = await checkCashBankAccount(accountId, companyId);
  if (problem) errors.account_id = problem;
  return errors;
}

async function validateAccount(
  values: FormValues,
  currentId: number | null,
  existing: Record<string, string>,
  applies: Set<string>
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  const companyId = refValue(values, "company_id");
  const parentId = refValue(values, "parent_account");
  const subcategoryId = refValue(values, "account_subcategory_id");

  // ---- the number, and the lineage it has to agree with ------------------
  //
  // Only ever checked while creating: `account_segment` is create-only and
  // both Kelompok and Parent Account are locked, so an existing account's
  // number cannot move and nothing below it can be orphaned.
  if (applies.has("account_segment")) {
    const segment = parseSegment(values.account_segment);
    if (segment == null) {
      if (!existing.account_segment) {
        errors.account_segment = `Nomor Urut harus bilangan bulat ${SEGMENT_RANGE_TEXT}.`;
      }
    } else if (parentId && subcategoryId) {
      // A parent decides the number, so it has to sit in the same kelompok:
      // otherwise the code would claim a place in the chart the account is
      // not actually in.
      const parent = await prisma.accAccount.findUnique({
        where: { id: parentId },
        select: { account_subcategory_id: true },
      });
      if (parent && parent.account_subcategory_id !== subcategoryId) {
        errors.parent_account =
          "Parent Account harus berada pada Kelompok Account yang sama.";
      }
    }

    // `derive` has already composed the code by now, so this is the check the
    // user's own number gets: two 1.1.1.10 in one Company are refused, while
    // 1.1.1.10 and 1.1.2.10 are different accounts and both may exist, as do
    // the induk's 1.1.4.1 and the anak's.
    const label = String(values.account_label ?? "");
    if (label && companyId && !errors.parent_account) {
      const taken = await checkAccountNumber(companyId, label, currentId);
      if (taken) errors.account_segment = taken;
    }
  }

  if (parentId && companyId && !existing.parent_account && !errors.parent_account) {
    if (currentId && parentId === currentId) {
      errors.parent_account = "Account tidak dapat menjadi parent dari dirinya sendiri.";
    } else {
      const parent = await prisma.accAccount.findUnique({
        where: { id: parentId },
        select: { company_id: true },
      });
      if (!parent) {
        errors.parent_account = "Parent Account tidak ditemukan.";
      } else if (parent.company_id !== companyId) {
        errors.parent_account =
          "Parent Account harus berada pada Company yang sama.";
      } else if (currentId && (await accountDescendants(currentId)).has(parentId)) {
        // Without this an account could be made a child of its own descendant,
        // and the tree would contain a loop no renderer could terminate on.
        errors.parent_account =
          "Parent Account tidak boleh berada di bawah account ini.";
      } else {
        // Giving an account a sub-account revokes its posting privilege, so
        // an account already in use cannot be given one: whatever points at
        // it as a destination would be left naming a heading, and the
        // postings already made to it would have no leaf accounting for them.
        // A miscoded account is deactivated, never restructured (rule 45).
        const used = [
          ...(await accountUsage(parentId)),
          ...(await systemDefaultsUsingAccount(parentId)),
        ];
        if (used.length) {
          errors.parent_account =
            `Account tersebut sudah dipakai (${used.join(", ")}), sehingga ` +
            "tidak dapat diberi sub-account. Sub-account mencabut hak posting " +
            "account induknya.";
        }
      }
    }
  }

  // An account that a Cash & Bank resource already posts to cannot be moved out
  // from under the rule that let it be chosen in the first place. `is_postable`
  // needs no clause here any more: it is no longer submitted at all, so an
  // account cannot be un-postabled from this path in the first place.
  if (currentId) {
    const dependents = await prisma.mCashBank.findMany({
      where: { account_id: currentId },
      select: { cash_bank_label: true },
    });
    if (dependents.length) {
      const used = dependents.map((d) => d.cash_bank_label).join(", ");
      if (!boolValue(values, "is_active")) {
        errors.is_active = `Account ini dipakai Cash & Bank (${used}) dan tidak dapat dinonaktifkan.`;
      }
      const subcategoryId = refValue(values, "account_subcategory_id");
      if (subcategoryId) {
        const sub = await prisma.accAccountSubcategory.findUnique({
          where: { id: subcategoryId },
          select: { subcategory_label: true },
        });
        if (sub && sub.subcategory_label !== CASH_BANK_SUBCATEGORY) {
          errors.account_subcategory_id = `Account ini dipakai Cash & Bank (${used}) dan harus tetap pada kelompok ${CASH_BANK_SUBCATEGORY} Kas / Setara Kas.`;
        }
      }
    }
  }

  return errors;
}

/**
 * A Budget Category has to be able to classify something.
 *
 * Both halves are refusals rather than silent corrections, because either one
 * would otherwise produce a category that reads as configured and admits
 * nothing. A category allowing neither direction can classify no Budget at all,
 * and one that names a Partner without admitting a Partner Category generates
 * no Purpose, so no document could ever name it.
 *
 * Both are answered on this one form now, which is why neither needs the record
 * to exist first — the checks are the same on create and on edit.
 */
/**
 * A Purpose has to name a combination its Budget Category actually admits.
 *
 * Nothing generates these rows, so nothing stops a maintainer entering one the
 * classification does not allow — and such a row could never be used: the
 * picker filters it out, and the Budget approval chain would refuse the
 * classification anyway. Refusing it here is the rule every other inert
 * combination gets, said at the point one would be created.
 */
async function validatePurpose(
  values: FormValues,
  currentId: number | null,
  existing: Record<string, string>
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  const categoryId = refValue(values, "budget_category_id");
  const partnerCategoryId = refValue(values, "partner_category_id");
  const direction = String(values.direction ?? "");
  if (existing.budget_category_id || existing.direction || !categoryId) return errors;

  const rule = (await loadClassification()).find((r) => r.id === categoryId);
  if (!rule) {
    errors.budget_category_id = "Budget Category tidak ditemukan.";
    return errors;
  }

  if (direction === "In" ? !rule.allowsIn : !rule.allowsOut) {
    errors.direction = `${rule.label} tidak berlaku untuk ${directionText(direction)}.`;
    return errors;
  }

  if (!rule.requirePartner) {
    if (partnerCategoryId) {
      errors.partner_category_id = `${rule.label} tidak memakai Partner, sehingga Purpose-nya tidak menyebut Partner Category.`;
      return errors;
    }
  } else {
    if (!partnerCategoryId) {
      errors.partner_category_id = `${rule.label} memakai Partner, sehingga Purpose-nya harus menyebut Partner Category.`;
      return errors;
    }
    const partner = await prisma.sysPartnerCategory.findUnique({
      where: { id: partnerCategoryId },
      select: { category_label: true },
    });
    if (!partner || !rule.partnerCategories.includes(partner.category_label)) {
      errors.partner_category_id = `${rule.label} tidak mengakui Partner Category itu. Tambahkan dulu pada Budget Category tersebut.`;
      return errors;
    }
  }

  // One Purpose per combination — the unique index is the backstop; this is the
  // message that says which row already holds it.
  const clash = await prisma.sysPurpose.findFirst({
    where: {
      budget_category_id: categoryId,
      partner_category_id: partnerCategoryId,
      direction: direction as "In" | "Out",
      ...(currentId ? { id: { not: currentId } } : {}),
    },
    select: { purpose_key: true, status: true },
  });
  if (clash) {
    errors.partner_category_id =
      clash.status === "Active"
        ? `Kombinasi ini sudah ada (${clash.purpose_key}).`
        : `Kombinasi ini sudah ada tetapi non-aktif (${clash.purpose_key}) — aktifkan record itu.`;
  }

  return errors;
}

function validateBudgetCategory(values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};

  // Arah is one required answer out of three, so "neither direction" is not a
  // state the form can reach. This refuses a crafted request naming a fourth,
  // which would otherwise reach the CHECK constraint as a raw database error.
  const mode = String(values.direction_mode ?? "");
  if (!["Out", "In", "Both"].includes(mode)) {
    errors.direction_mode = "Pilih arah: Pengeluaran saja, Penerimaan saja, atau Keduanya.";
  }

  // The subject book has to rise in a direction the category actually moves. A
  // book set to rise on Penerimaan under a Pengeluaran-only category would
  // record every posting as a *fall*: the position would grow negative and the
  // report would read exactly backwards with nothing to say so.
  //
  // Only "Keduanya" can get this wrong — `derivedColumns` answers it for the
  // other two — but the check stays, because the action is reachable directly.
  const raises = String(values.raises ?? "");
  if (mode === "In" && raises === "Out") {
    errors.raises =
      "Category ini hanya berlaku untuk Penerimaan, sehingga posisinya tidak dapat naik saat Pengeluaran.";
  }
  if (mode === "Out" && raises === "In") {
    errors.raises =
      "Category ini hanya berlaku untuk Pengeluaran, sehingga posisinya tidak dapat naik saat Penerimaan.";
  }

  // A category that names a Partner keeps a book and needs Purposes, and both
  // come from the Partner Categories it admits — which are on this same form,
  // so this is now an ordinary required field rather than a reason to save the
  // record inactive and come back to it.
  //
  // The old refusal pointed at a second menu ("simpan dulu dengan status Non
  // Aktif, tambahkan Partner Category pada menu…"). That menu is gone: the
  // state it guarded against is unreachable once the set is written in the same
  // transaction as the record.
  if (boolValue(values, "require_partner") && !idList(values.partner_category_ids).length) {
    errors.partner_category_ids = "Pilih minimal satu Partner Category.";
  }

  // Clearing the flag is allowed and retires every pairing with it — the
  // reconcile does that, because the field no longer applies. What it must not
  // do is leave the two contradicting each other, which is why they are one
  // submission.

  return errors;
}

async function validateMapping(
  values: FormValues,
  currentId: number | null,
  existing: Record<string, string>,
  applies: Set<string>
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  const companyId = refValue(values, "company_id");
  const budgetCategoryId = refValue(values, "budget_category_id");
  const partnerCategoryId = applies.has("partner_category_id")
    ? refValue(values, "partner_category_id")
    : null;
  const accountId = refValue(values, "account_id");

  if (budgetCategoryId) {
    const rule = await partnerCategoriesForBudgetCategory(budgetCategoryId);
    if (rule) {
      if (rule.needsPartner && !partnerCategoryId) {
        errors.partner_category_id =
          "Budget Category ini mensyaratkan Partner Category.";
      }
      if (
        partnerCategoryId &&
        !rule.allowedIds.includes(partnerCategoryId)
      ) {
        errors.partner_category_id =
          "Partner Category tersebut tidak berlaku untuk Budget Category ini.";
      }
    }
  }

  if (accountId && companyId && !existing.account_id) {
    const account = await prisma.accAccount.findUnique({
      where: { id: accountId },
      select: { company_id: true, is_postable: true, is_active: true },
    });
    if (!account) errors.account_id = "Account tidak ditemukan.";
    else if (account.company_id !== companyId) {
      errors.account_id = "Account harus milik Company yang sama.";
    } else if (!account.is_postable) {
      errors.account_id = "Account header tidak dapat menjadi tujuan posting.";
    } else if (!account.is_active) {
      errors.account_id = "Account tersebut non-aktif dan tidak dapat dipilih.";
    } else {
      // A parent account is a heading over where money lands, not a place it
      // lands — so a mapping may never resolve to one.
      const notLeaf = await checkAccountIsLeaf(accountId);
      if (notLeaf) errors.account_id = notLeaf;
    }
  }

  if (companyId && budgetCategoryId && !errors.partner_category_id) {
    const clash = await prisma.accBudgetCategoryAccount.findFirst({
      where: {
        company_id: companyId,
        budget_category_id: budgetCategoryId,
        partner_category_id: partnerCategoryId,
        ...(currentId ? { id: { not: currentId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      errors.account_id =
        "Kombinasi Company, Budget Category, dan Partner Category ini sudah dipetakan.";
    }
  }

  return errors;
}

/**
 * Columns an entity writes that no field on its form offers.
 *
 * `Arah` is one question with three answers and is stored as two booleans,
 * because two booleans is what every reader already asks for — the subject
 * book's nature, the Purpose generator's direction list, the CHECK constraints.
 * Presenting them as two checkboxes is what let both be switched off.
 *
 * `raises` rides along for the same reason in reverse: a category that moves
 * one way can only have a book running that way, so the form stops asking and
 * this answers. Where it does ask — "Keduanya" — whatever was chosen stands.
 */
function derivedColumns(
  entity: Entity,
  values: FormValues
): Record<string, unknown> {
  if (entity.key !== "sys_budget_category") return {};

  const mode = String(values.direction_mode ?? "");
  const both = mode === "Both";
  const raises = !boolValue(values, "require_partner")
    ? null
    : both
      ? (values.raises ?? null)
      : mode === "In" || mode === "Out"
        ? mode
        : null;

  return {
    allows_out: mode === "Out" || both,
    allows_in: mode === "In" || both,
    raises,
  };
}

function buildData(entity: Entity, values: FormValues, applies: Set<string>) {
  const data: Record<string, unknown> = {};
  for (const field of entity.fields) {
    if (field.virtual) continue;
    data[field.name] = applies.has(field.name)
      ? coerce(field, values[field.name])
      : field.type === "bool"
        ? false
        : null;
  }
  return data;
}

/**
 * A book's counterpart account declares itself — and stops declaring itself.
 *
 * A Cash & Bank resource registered on an account makes that account the Cash
 * Bank Book's counterpart; a mapping from a Budget Category that keeps a
 * subject book makes its target that book's. Either way the account's balance
 * is reconciled against something outside the General Ledger, and writing to
 * it by hand would put the two out of agreement — so the structure decides
 * `is_control_account` rather than leaving it to somebody remembering to tick
 * a box. The same shape as a parent account giving up `is_postable`.
 *
 * `previousAccountId` is what makes it work in both directions. Repointing a
 * Cash & Bank or a mapping releases the account it used to name, provided
 * nothing else still claims it — `syncControlAccounts` re-asks rather than
 * assuming, because two mappings can share one target.
 *
 * A mapping whose category keeps no book — Asset, Biaya — claims nothing. Its
 * target reconciles against the General Ledger alone, which is exactly the
 * kind of account a manual journal exists to reach.
 */
/**
 * Nothing regenerates the Transaction Purposes, deliberately.
 *
 * They were briefly derived from the classification, so a Budget Category
 * created through the GUI was transactable the moment it was saved. That is
 * reversed on the user's instruction: `sys_purpose` stands in for what a
 * maintainer would type into the database, so it is filled in through Master ›
 * Klasifikasi › Transaction Purpose and the application writes no row on their
 * behalf.
 *
 * A Budget Category with no Purpose therefore cannot be transacted. That is the
 * intended outcome and not a fault — it means whoever added the category has
 * not finished. The Budget Category list states how many Purposes each one
 * holds, so the gap is visible rather than silent.
 */

/** Ids submitted for a multiref, however the form serialised them. */
function idList(value: unknown): number[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string" && value !== ""
      ? value.split(",")
      : [];
  return [
    ...new Set(raw.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)),
  ];
}

/**
 * What each `multiref` field on this entity should hold after this submission.
 *
 * A field that does not apply admits nothing — clearing "Memakai Partner"
 * retires every pairing rather than leaving them pointing at a category that no
 * longer names a subject.
 */
function wantedSets(
  entity: Entity,
  values: FormValues,
  applies: Set<string>
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const field of entity.fields) {
    if (field.type !== "multiref") continue;
    out[field.name] = applies.has(field.name) ? idList(values[field.name]) : [];
  }
  return out;
}

async function syncControlAccountsFor(
  entityKey: string,
  values: FormValues,
  actorId: number,
  previousAccountId?: number | null
): Promise<void> {
  if (entityKey !== "m_cash_bank" && entityKey !== "acc_budget_category_account") {
    return;
  }

  const touched = new Set<number>();
  const accountId = refValue(values, "account_id");
  if (accountId) touched.add(accountId);
  if (previousAccountId) touched.add(previousAccountId);
  if (!touched.size) return;

  await syncControlAccounts(touched, await systemDefaultAccountIds(), actorId);
}

/** The account a Cash & Bank or a mapping names today, before it is rewritten. */
async function currentAccountId(
  entityKey: string,
  id: number
): Promise<number | null> {
  if (entityKey !== "m_cash_bank" && entityKey !== "acc_budget_category_account") {
    return null;
  }
  const row = await delegate(entityKey).findUnique({
    where: { id },
    select: { account_id: true },
  });
  return row ? Number(row.account_id) : null;
}

export async function createRecord(
  slug: string,
  values: FormValues
): Promise<SaveResult> {
  // Company is create-locked: the two-company structure is foundational, so the
  // count can never change from the application. Checked before the permission
  // check because it holds for everyone, whatever they are allowed to do.
  if (isCompanyEntity(slug)) {
    return { ok: false, errors: { _form: COMPANY_CREATE_BLOCKED } };
  }

  const entity = requireEntity(slug);
  const guard = await authorize(entity.key, "create");
  if (!guard.ok) return guard.denial;
  const actor = guard.actor;

  values = await derive(entity, values);
  const applies = await applicableFields(entity, values, false);
  const errors = await validate(entity, values, null, applies);
  if (Object.keys(errors).length) return { ok: false, errors };

  const code = await nextCode(entity);
  const created = await prisma.$transaction(async (tx) => {
    const row = await delegate(entity.key, tx).create({
      data: {
        ...buildData(entity, values, applies),
        ...derivedColumns(entity, values),
        [entity.codeField]: code,
        created_by: actor.user.id,
        updated_by: null,
      },
    });

    // An account that gains a sub-account stops being a place money lands and
    // becomes a heading over the places it lands, so it gives up its posting
    // privilege here — in the same transaction as the child, because a chart
    // in which a parent is still postable is a chart somebody can post into
    // twice. `validateAccount` has already refused a parent that anything
    // depends on, so nothing is being pulled out from under a live reference,
    // and it is one-way: nothing in the application makes an account postable
    // again, because nothing removes the sub-account either.
    if (entity.key === "acc_account") {
      const parentId = refValue(values, "parent_account");
      if (parentId) {
        await tx.accAccount.update({
          where: { id: parentId },
          data: { is_postable: false, updated_by: actor.user.id },
        });
      }
    }

    // A Cash & Bank resource gets its book in the same transaction it is
    // registered in, so no resource can ever exist without one. A non-zero
    // starting figure becomes the book's opening entry rather than a column on
    // the master — see `lib/siba/cash-bank.ts`.
    if (entity.key === "m_cash_bank") {
      // A foreign resource keeps rate layers and opens its first one here; a
      // base-currency resource has none and opens at `1`, which is true rather
      // than a placeholder. `validateCashBank` has already refused a foreign
      // opening balance with no kurs, so by here the rate is honest.
      const currencyId = refValue(values, "currency_id");
      const currencyLabel = currencyId
        ? await refLabel("ref_currency", currencyId)
        : null;
      const layered = Boolean(currencyLabel) && !isBaseCurrency(currencyLabel);
      await openCashBankBook(tx, {
        cashBankId: row.id,
        openingBalance: numberValue(values, "opening_balance") ?? 0,
        rate: layered ? numberValue(values, "opening_rate") ?? 1 : 1,
        layered,
        date: new Date().toISOString().slice(0, 10),
        actorId: actor.user.id,
      });
    }

    // The set a record admits is written with the record, never after it. A
    // Budget Category saved without its Partner Categories cannot be
    // transacted, so the two are one save or neither.
    await reconcileMultiref(tx, entity, row.id, wantedSets(entity, values, applies), actor.user.id);

    return row;
  });

  await syncControlAccountsFor(entity.key, values, actor.user.id);

  await prisma.auditLog.create({
    data: {
      entity_key: entity.key,
      row_id: created.id,
      action: "TAMBAH",
      event: "create",
      by: actor.user.id,
    },
  });

  revalidatePath(`/${entity.module}/${entity.slug}`);
  revalidatePath("/dashboard");
  return { ok: true, id: created.id, code };
}

export async function updateRecord(
  slug: string,
  id: number,
  values: FormValues
): Promise<SaveResult> {
  // Company is edit-locked for the same reason it is create-locked. Identity
  // changes are made directly in the database, not through this path.
  if (isCompanyEntity(slug)) {
    return { ok: false, errors: { _form: COMPANY_UPDATE_BLOCKED } };
  }

  const entity = requireEntity(slug);
  const guard = await authorize(entity.key, "edit");
  if (!guard.ok) return guard.denial;
  const actor = guard.actor;

  values = await derive(entity, values);
  const applies = await applicableFields(entity, values, true);
  const errors = await validate(entity, values, id, applies);
  if (Object.keys(errors).length) return { ok: false, errors };

  const data = { ...buildData(entity, values, applies), ...derivedColumns(entity, values) };
  // Locked fields are immutable once the record exists.
  for (const field of entity.fields) {
    if (field.locked) delete data[field.name];
  }

  // Read before the write: repointing a Cash & Bank or a mapping has to
  // release the account it used to name, and once the row is updated there is
  // nothing left that remembers which account that was.
  const previousAccountId = await currentAccountId(entity.key, id);

  await prisma.$transaction(async (tx) => {
    await delegate(entity.key, tx).update({
      where: { id },
      data: { ...data, updated_by: actor.user.id },
    });
    await reconcileMultiref(tx, entity, id, wantedSets(entity, values, applies), actor.user.id);
  });

  await syncControlAccountsFor(entity.key, values, actor.user.id, previousAccountId);

  await prisma.auditLog.create({
    data: {
      entity_key: entity.key,
      row_id: id,
      action: "UPDATE",
      event: "update",
      by: actor.user.id,
    },
  });

  revalidatePath(`/${entity.module}/${entity.slug}`);
  revalidatePath(`/${entity.module}/${entity.slug}/${id}`);
  revalidatePath("/dashboard");
  return { ok: true, id };
}

export async function toggleStatus(
  slug: string,
  id: number
): Promise<{ ok: boolean; active?: boolean; message?: string }> {
  // Deactivating is an edit, so the company lock covers it too.
  if (isCompanyEntity(slug)) {
    return { ok: false, message: COMPANY_UPDATE_BLOCKED };
  }

  const entity = requireEntity(slug);
  const model = entity.statusModel;
  if (!model?.toggle) {
    return { ok: false, message: `${entity.name} tidak memiliki status aktif/non-aktif.` };
  }

  const row = await delegate(entity.key).findUnique({ where: { id } });
  if (!row) return { ok: false, message: "Data tidak ditemukan." };

  const wasActive =
    model.kind === "bool" ? row[model.field] === true : row[model.field] === "Active";
  const nextActive = !wasActive;

  // Activating and deactivating are separate capabilities, so the direction of
  // the toggle decides which permission is required.
  const guard = await authorize(entity.key, nextActive ? "activate" : "deactivate");
  if (!guard.ok) return { ok: false, message: guard.denial.errors._form };
  const actor = guard.actor;

  // Activating a Budget Category that names a Partner but has none paired to it
  // would produce a record that generates no Purpose and keeps a book nothing
  // can post to — configured-looking and inert.
  if (entity.key === "sys_budget_category" && nextActive) {
    if (row.require_partner === true) {
      const stranded = await strandedCategories({ onlyCategoryId: id });
      if (stranded.length) {
        return {
          ok: false,
          message:
            "Category ini memakai Partner tetapi belum memiliki Partner Category. " +
            "Tambahkan minimal satu pada menu Partner Category per Budget Category sebelum mengaktifkannya.",
        };
      }
    }
  }

  // Retiring the last pairing of an Active category strands it the same way,
  // reached from the other side.
  if (entity.key === "sys_budget_partner_category_mapping" && !nextActive) {
    const stranded = await strandedCategories({ ignorePairingId: id });
    if (stranded.length) {
      return {
        ok: false,
        message:
          `Ini satu-satunya Partner Category untuk ${stranded.join(", ")}. ` +
          "Nonaktifkan Budget Category tersebut lebih dulu, atau tambahkan Partner Category lain.",
      };
    }
  }

  // And so does deactivating the Partner Category those pairings point at.
  if (entity.key === "sys_partner_category" && !nextActive) {
    const stranded = await strandedCategories({ ignorePartnerCategoryId: id });
    if (stranded.length) {
      return {
        ok: false,
        message:
          `Partner Category ini satu-satunya yang dipakai ${stranded.join(", ")}. ` +
          "Nonaktifkan Budget Category tersebut lebih dulu, atau tambahkan Partner Category lain.",
      };
    }
  }

  // Deactivating an account that a Cash & Bank resource posts to would leave
  // that resource pointing at an account it could no longer have chosen.
  if (entity.key === "acc_account" && !nextActive) {
    const dependents = await prisma.mCashBank.findMany({
      where: { account_id: id },
      select: { cash_bank_label: true },
    });
    if (dependents.length) {
      return {
        ok: false,
        message: `Account ini dipakai Cash & Bank (${dependents
          .map((d) => d.cash_bank_label)
          .join(", ")}) dan tidak dapat dinonaktifkan.`,
      };
    }
  }

  await delegate(entity.key).update({
    where: { id },
    data: {
      [model.field]: model.kind === "bool" ? nextActive : nextActive ? "Active" : "Inactive",
      updated_by: actor.user.id,
    },
  });

  // The status toggle is the only lifecycle a master record has, so it is
  // recorded as the step it is rather than as an anonymous edit — otherwise a
  // Partner's history could not say when it stopped being selectable.
  await prisma.auditLog.create({
    data: {
      entity_key: entity.key,
      row_id: id,
      action: "UPDATE",
      event: nextActive ? "activate" : "deactivate",
      by: actor.user.id,
    },
  });


  revalidatePath(`/${entity.module}/${entity.slug}`);
  revalidatePath(`/${entity.module}/${entity.slug}/${id}`);
  revalidatePath("/dashboard");
  return { ok: true, active: nextActive };
}
