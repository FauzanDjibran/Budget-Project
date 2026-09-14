/**
 * Which permission each registry entity's operations require.
 *
 * The Master module is registry-driven, so its authorization is registry-driven
 * too: one map instead of a check written out in every page and action. Adding
 * an entity means adding its row here — the same shape as adding it to
 * `entities.ts`.
 *
 * Client-safe (no `server-only`, no database import): the list and form
 * components read the same map the Server Actions enforce, so a hidden button
 * and a rejected action can never disagree about which permission is at stake.
 */
import type { PermissionCode } from "./permissions";

export type EntityPermissions = {
  view: PermissionCode;
  /** Absent where the operation does not exist — Company is create/edit-locked. */
  create?: PermissionCode;
  edit?: PermissionCode;
  activate?: PermissionCode;
  deactivate?: PermissionCode;
};

const ENTITY_PERMISSIONS: Record<string, EntityPermissions> = {
  sys_company: { view: "COMPANY_VIEW" },
  m_partner: {
    view: "PARTNER_VIEW",
    create: "PARTNER_CREATE",
    edit: "PARTNER_EDIT",
    activate: "PARTNER_ACTIVATE",
    deactivate: "PARTNER_DEACTIVATE",
  },
  m_cash_bank: {
    view: "CASH_BANK_VIEW",
    create: "CASH_BANK_CREATE",
    edit: "CASH_BANK_EDIT",
    activate: "CASH_BANK_ACTIVATE",
    deactivate: "CASH_BANK_DEACTIVATE",
  },
  ref_currency: {
    view: "CURRENCY_VIEW",
    create: "CURRENCY_CREATE",
    edit: "CURRENCY_EDIT",
    activate: "CURRENCY_ACTIVATE",
    deactivate: "CURRENCY_DEACTIVATE",
  },
};

/**
 * Throws rather than returning a default, so an entity added to the registry
 * without a permission row fails loudly instead of silently becoming open.
 */
export function entityPermissions(entityKey: string): EntityPermissions {
  const perms = ENTITY_PERMISSIONS[entityKey];
  if (!perms) {
    throw new Error(`No permissions declared for entity: ${entityKey}`);
  }
  return perms;
}

export function hasEntityPermissions(entityKey: string): boolean {
  return entityKey in ENTITY_PERMISSIONS;
}

/** What the current user may do with one entity — passed into the client. */
export type EntityAbilities = {
  create: boolean;
  edit: boolean;
  activate: boolean;
  deactivate: boolean;
};

export function abilitiesFor(
  entityKey: string,
  permissions: Iterable<string>
): EntityAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  const perms = entityPermissions(entityKey);
  const has = (code?: PermissionCode) => Boolean(code && held.has(code));
  return {
    create: has(perms.create),
    edit: has(perms.edit),
    activate: has(perms.activate),
    deactivate: has(perms.deactivate),
  };
}
