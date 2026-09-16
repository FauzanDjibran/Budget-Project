import { notFound } from "next/navigation";
import { AccountTree } from "@/components/master/account-tree";
import { companyScope } from "@/lib/siba/company-access";
import { FiscalPeriods } from "@/components/accounting/fiscal-periods";
import { FiscalYearActions } from "@/components/accounting/fiscal-year-actions";
import { CashBankBookCard } from "@/components/master/cash-bank-book-card";
import { EntityForm } from "@/components/master/entity-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { EntityLocked } from "@/components/master/entity-locked";
import { can as actorHas, requirePermission } from "@/lib/siba/auth";
import { isCompanyEntity } from "@/lib/siba/company";
import { abilitiesFor, entityPermissions } from "@/lib/siba/entity-access";
import { entityBySlug, type Entity } from "@/lib/siba/entities";
import {
  accountTree,
  columnRefOptions,
  computedValues,
  getRow,
  listRows,
  refOptions,
} from "@/lib/siba/records";
import { cashBankBookSummary } from "@/lib/siba/cash-bank";
import { fiscalYearPeriods } from "@/lib/siba/fiscal";
import { defaultCurrencyId } from "@/lib/siba/system-settings";
import {
  fiscalYearAbilities,
  availableActions as availableFiscalActions,
  type FiscalYearStatus,
} from "@/lib/siba/fiscal-workflow";
import type { ActionTone } from "@/lib/siba/header-actions";
import { userEmails } from "@/lib/siba/users";
import { EntityList } from "@/components/master/entity-list";

/**
 * The four registry pages, written once and mounted under each module that owns
 * registry entities (`/master/[entity]`, `/accounting/[entity]`).
 *
 * The route's own module is passed in and checked: `/accounting/partner` is not
 * a second way into Partner, it is a 404. Without that, one entity would have
 * two URLs and two sets of breadcrumbs.
 */
function resolve(moduleKey: string, slug: string): Entity {
  const entity = entityBySlug(slug);
  if (!entity || entity.module !== moduleKey) notFound();
  return entity;
}

export async function EntityListPage({
  module: moduleKey,
  slug,
  company,
}: {
  module: string;
  slug: string;
  /** The page's own `?company=` parameter, for entities that declare a scope. */
  company?: string;
}) {
  const entity = resolve(moduleKey, slug);

  // Reading the list is its own permission, checked before a single row is read.
  const actor = await requirePermission(
    entityPermissions(entity.key).view,
    `/${entity.module}/${entity.slug}`
  );
  const can = abilitiesFor(entity.key, actor.permissions);

  // A Company-scoped entity shows one Company at a time, chosen from the
  // Companies this user's permissions open. The registry's `scope` is what
  // decides which entities those are; everything else ignores this entirely.
  const scope = entity.scope
    ? await companyScope(actor.permissions, company)
    : null;
  const companyId = scope ? scope.selected?.id ?? null : null;

  if (entity.view === "tree") {
    const tree =
      companyId == null ? null : await accountTree(companyId);
    return (
      <AccountTree
        entity={entity}
        companies={scope?.options ?? []}
        company={tree?.company ?? null}
        categories={tree?.categories ?? []}
        accounts={tree?.accounts ?? []}
        can={can}
      />
    );
  }

  const rows = await listRows(entity, companyId);
  const computed = await computedValues(entity, rows);
  // Columns can reference entities the form never edits, so top those up.
  const refs = await columnRefOptions(entity, await refOptions(entity));

  return (
    <EntityList
      entity={entity}
      rows={rows}
      refs={refs}
      computed={computed}
      can={can}
      companies={scope?.options ?? []}
      companyId={companyId}
    />
  );
}

export async function EntityNewPage({
  module: moduleKey,
  slug,
}: {
  module: string;
  slug: string;
}) {
  const entity = resolve(moduleKey, slug);

  // Company is create-locked — the route renders an explanation, never a form.
  // Reading the explanation still needs permission to see the entity at all.
  if (isCompanyEntity(entity.slug)) {
    await requirePermission(
      entityPermissions(entity.key).view,
      `/${entity.module}/${entity.slug}/new`
    );
    return (
      <EntityLocked
        entity={entity}
        mode="new"
        backHref={`/${entity.module}/${entity.slug}`}
      />
    );
  }

  const create = entityPermissions(entity.key).create;
  if (!create) notFound();
  const actor = await requirePermission(create, `/${entity.module}/${entity.slug}/new`);

  const refs = await refOptions(entity);

  return (
    <EntityForm
      entity={entity}
      mode="new"
      row={null}
      refs={refs}
      can={abilitiesFor(entity.key, actor.permissions)}
      defaults={{ default_currency: await defaultCurrencyId() }}
    />
  );
}

export async function EntityDetailPage({
  module: moduleKey,
  slug,
  id,
}: {
  module: string;
  slug: string;
  id: string;
}) {
  const entity = resolve(moduleKey, slug);

  const actor = await requirePermission(
    entityPermissions(entity.key).view,
    `/${entity.module}/${entity.slug}/${id}`
  );

  const row = await getRow(entity, Number(id));
  if (!row) notFound();

  const refs = await refOptions(entity);
  const emails = await userEmails([row.created_by as number, row.updated_by as number]);

  // A Fiscal Year has a lifecycle rather than a status field: it is activated,
  // which is what generates its periods. Everything else here is registry-driven.
  const fiscalStatus = String(row.status ?? "Draft") as FiscalYearStatus;
  const fiscalCan = fiscalYearAbilities(actor.permissions);
  const headerActions =
    entity.key === "acc_fiscal_year" ? (
      <FiscalYearActions
        id={row.id}
        subject={`${row.year_label} – ${row.year_name}`}
        status={fiscalStatus}
        can={fiscalCan}
      />
    ) : undefined;

  // A header carries one primary and it is the rightmost button. Activating a
  // Fiscal Year is the chief thing that screen is for, so where it is offered
  // Ubah steps down to neutral and sits to its left — the same arrangement
  // Budget and Cash Bank Transaction already use for Ubah beside a lifecycle
  // action. With nothing to activate, Ubah is the primary again.
  const editTone: ActionTone =
    entity.key === "acc_fiscal_year" &&
    availableFiscalActions(fiscalStatus, fiscalCan).length > 0
      ? "neutral"
      : "primary";

  const form = (
    <EntityForm
      entity={entity}
      mode="view"
      row={row}
      refs={refs}
      createdByEmail={emails[row.created_by as number]}
      updatedByEmail={emails[row.updated_by as number]}
      can={abilitiesFor(entity.key, actor.permissions)}
      headerActions={headerActions}
      editTone={editTone}
    />
  );

  // A Fiscal Year owns its twelve months, and they are visible nowhere else —
  // Fiscal Period has no menu and no form of its own.
  if (entity.key === "acc_fiscal_year") {
    return (
      <>
        {form}
        <FiscalPeriods
          periods={await fiscalYearPeriods(row.id)}
          yearLabel={String(row.year_label ?? "")}
          yearStatus={String(row.status ?? "")}
        />
        <RecordHistoryCard entityKey={entity.key} rowId={row.id} />
      </>
    );
  }

  // A Cash & Bank resource is the one master with a book behind it, so its
  // detail says what that book adds up to and shows the way into it. The book
  // itself is a report, not a property of the master — see `CashBankBookCard`.
  if (entity.key !== "m_cash_bank") {
    return (
      <>
        {form}
        <RecordHistoryCard entityKey={entity.key} rowId={row.id} />
      </>
    );
  }

  const summary = await cashBankBookSummary(row.id);
  const currencyLabel =
    refs.currency_id?.find((o) => o.id === row.currency_id)?.label ?? "IDR";

  return (
    <>
      {form}
      <CashBankBookCard
        cashBankId={row.id}
        balance={summary.balance}
        entries={summary.entries}
        lastEntryDate={summary.lastEntryDate}
        currencyLabel={currencyLabel}
        canViewReport={await actorHas("REPORT_CASH_BANK_LEDGER_VIEW")}
      />
      <RecordHistoryCard entityKey={entity.key} rowId={row.id} />
    </>
  );
}

export async function EntityEditPage({
  module: moduleKey,
  slug,
  id,
}: {
  module: string;
  slug: string;
  id: string;
}) {
  const entity = resolve(moduleKey, slug);

  // A locked entity explains itself rather than demanding an edit permission
  // nobody can hold — but reading that explanation still requires being allowed
  // to see the entity in the first place.
  if (isCompanyEntity(entity.slug)) {
    await requirePermission(
      entityPermissions(entity.key).view,
      `/${entity.module}/${entity.slug}/${id}/edit`
    );
    const row = await getRow(entity, Number(id));
    if (!row) notFound();
    const label = entity.labelField ? String(row[entity.labelField] ?? "") : "";
    const name = entity.nameField ? String(row[entity.nameField] ?? "") : "";
    return (
      <EntityLocked
        entity={entity}
        mode="edit"
        subject={label ? `${label} – ${name}` : name}
        backHref={`/${entity.module}/${entity.slug}/${row.id}`}
      />
    );
  }

  const edit = entityPermissions(entity.key).edit;
  if (!edit) notFound();
  const actor = await requirePermission(edit, `/${entity.module}/${entity.slug}/${id}/edit`);

  const row = await getRow(entity, Number(id));
  if (!row) notFound();

  const refs = await refOptions(entity);
  const emails = await userEmails([row.created_by as number, row.updated_by as number]);

  return (
    <>
      <EntityForm
        entity={entity}
        mode="edit"
        row={row}
        refs={refs}
        createdByEmail={emails[row.created_by as number]}
        updatedByEmail={emails[row.updated_by as number]}
        can={abilitiesFor(entity.key, actor.permissions)}
      />
      <RecordHistoryCard entityKey={entity.key} rowId={row.id} />
    </>
  );
}
