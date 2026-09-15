import { notFound } from "next/navigation";
import { AccountTree } from "@/components/master/account-tree";
import { CashBankBook } from "@/components/master/cash-bank-book";
import { EntityForm } from "@/components/master/entity-form";
import { EntityLocked } from "@/components/master/entity-locked";
import { requirePermission } from "@/lib/siba/auth";
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
import { cashBankBalanceMap, cashBankLedger } from "@/lib/siba/cash-bank";
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
}: {
  module: string;
  slug: string;
}) {
  const entity = resolve(moduleKey, slug);

  // Reading the list is its own permission, checked before a single row is read.
  const actor = await requirePermission(
    entityPermissions(entity.key).view,
    `/${entity.module}/${entity.slug}`
  );
  const can = abilitiesFor(entity.key, actor.permissions);

  if (entity.view === "tree") {
    const { categories, accounts } = await accountTree();
    return (
      <AccountTree
        entity={entity}
        categories={categories}
        accounts={accounts}
        can={can}
      />
    );
  }

  const rows = await listRows(entity);
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

  const form = (
    <EntityForm
      entity={entity}
      mode="view"
      row={row}
      refs={refs}
      createdByEmail={emails[row.created_by as number]}
      updatedByEmail={emails[row.updated_by as number]}
      can={abilitiesFor(entity.key, actor.permissions)}
    />
  );

  // A Cash & Bank resource is the one master with a book behind it, so its
  // detail shows that book. The registry describes fields; it does not describe
  // an append-only ledger, and nothing is gained by making it try.
  if (entity.key !== "m_cash_bank") return form;

  const [entries, balances] = await Promise.all([
    cashBankLedger(row.id),
    cashBankBalanceMap(),
  ]);
  const currencyLabel =
    refs.currency_id?.find((o) => o.id === row.currency_id)?.label ?? "IDR";

  return (
    <>
      {form}
      <CashBankBook
        entries={entries}
        balance={balances.get(row.id) ?? 0}
        currencyLabel={currencyLabel}
      />
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
    <EntityForm
      entity={entity}
      mode="edit"
      row={row}
      refs={refs}
      createdByEmail={emails[row.created_by as number]}
      updatedByEmail={emails[row.updated_by as number]}
      can={abilitiesFor(entity.key, actor.permissions)}
    />
  );
}
