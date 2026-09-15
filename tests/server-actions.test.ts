import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { actorCan, actorCanAll } from "../src/lib/siba/access";
import { AccessDeniedError, isAccessDenied } from "../src/lib/siba/auth-errors";
import { actorOf, cleanup, disconnect, makeUser } from "./helpers";

/**
 * The bypass question: can a request that never touches the UI get through?
 *
 * Two halves. The first is structural — every exported Server Action must
 * resolve the caller before it does anything, so none can be reached
 * anonymously. The second checks the workflow permissions the UI has no pages
 * for yet, at the level the future pages will ask.
 */

const ACTIONS_DIR = path.join(process.cwd(), "src/app/actions");

/** The helpers that establish who is calling. An action must use one of them. */
const GUARDS = [
  "actorOrDeny",
  "authorizeAction",
  "authorize(",
  "requireAuth",
  "requirePermission",
];

function actionFiles(): string[] {
  return readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts"));
}

/**
 * Exported async function bodies, so each can be inspected on its own.
 *
 * The parameter list is skipped by matching parentheses, and the body is then
 * the first brace that ends a line — a return type such as
 * `Promise<{ ok: boolean }>` opens its brace mid-line and is passed over.
 *
 * Line endings are normalised first: git checks these files out with CRLF on
 * Windows, and "the brace that ends a line" would otherwise match nothing
 * there, leaving the suite green on CI and vacuous on a developer's machine.
 */
function exportedActions(input: string): { name: string; body: string }[] {
  const source = input.replace(/\r\n/g, "\n");
  const out: { name: string; body: string }[] = [];
  const pattern = /export async function (\w+)\s*\(/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    let i = match.index + match[0].length;
    for (let parens = 1; i < source.length && parens > 0; i += 1) {
      if (source[i] === "(") parens += 1;
      else if (source[i] === ")") parens -= 1;
    }

    let start = -1;
    for (let j = i; j < source.length; j += 1) {
      if (source[j] === "{" && source[j + 1] === "\n") {
        start = j;
        break;
      }
    }
    if (start === -1) continue;

    let depth = 0;
    let end = start;
    for (let j = start; j < source.length; j += 1) {
      if (source[j] === "{") depth += 1;
      else if (source[j] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    out.push({ name: match[1], body: source.slice(start, end + 1) });
  }
  return out;
}

/** Guards against the extractor silently matching nothing and passing vacuously. */
function assertFound(file: string, actions: { name: string }[]) {
  assert.ok(actions.length > 0, `${file}: no exported actions were parsed`);
}

describe("server actions cannot be reached anonymously", () => {
  test("every action file declares itself a server module", () => {
    for (const file of actionFiles()) {
      const source = readFileSync(path.join(ACTIONS_DIR, file), "utf-8");
      assert.match(source.trimStart(), /^"use server";/, `${file} must start with "use server"`);
    }
  });

  test("every exported action resolves the caller before acting", () => {
    // `auth.ts` is the one exception by definition: sign-in is what a caller
    // without a session is for. It is listed explicitly so a new unguarded
    // action file cannot be added silently.
    const publicActions = new Set(["login", "logout", "isSignedIn"]);

    for (const file of actionFiles()) {
      const source = readFileSync(path.join(ACTIONS_DIR, file), "utf-8");
      const actions = exportedActions(source);
      assertFound(file, actions);

      for (const action of actions) {
        if (publicActions.has(action.name)) continue;
        const guarded = GUARDS.some((g) => action.body.includes(g));
        assert.ok(
          guarded,
          `${file}:${action.name} does not resolve the caller — it would be callable anonymously`
        );
      }
    }
  });

  test("no action writes to the database without passing through a guard first", () => {
    for (const file of actionFiles()) {
      const source = readFileSync(path.join(ACTIONS_DIR, file), "utf-8");
      const actions = exportedActions(source);
      assertFound(file, actions);

      for (const action of actions) {
        const write = action.body.search(/prisma\.\w+\.(create|update|delete|upsert)/);
        if (write === -1) continue;

        const guardAt = Math.min(
          ...GUARDS.map((g) => action.body.indexOf(g)).filter((i) => i !== -1)
        );
        assert.ok(
          Number.isFinite(guardAt) && guardAt < write,
          `${file}:${action.name} writes before establishing who is calling`
        );
      }
    }
  });

  test("an unauthenticated denial is distinguishable from an unauthorized one", () => {
    const anonymous = new AccessDeniedError("UNAUTHENTICATED");
    const forbidden = new AccessDeniedError("UNAUTHORIZED");

    assert.equal(anonymous.kind, "UNAUTHENTICATED");
    assert.equal(forbidden.kind, "UNAUTHORIZED");
    assert.ok(isAccessDenied(anonymous));
    assert.ok(!isAccessDenied(new Error("something else")));
  });

  test("denial messages leak nothing about the authorization model", () => {
    for (const kind of ["UNAUTHENTICATED", "UNAUTHORIZED"] as const) {
      const message = new AccessDeniedError(kind).message;
      assert.ok(!/_[A-Z]{2,}/.test(message), "a permission code must not appear");
      assert.ok(!message.includes("permission_code"));
      assert.ok(!message.toLowerCase().includes("prisma"));
    }
  });
});

describe("workflow permissions", () => {
  before(cleanup);
  after(async () => {
    await cleanup();
    await disconnect();
  });

  /**
   * These assert the shape of the model rather than any one page: a capability
   * is never implied by another. Seeing a module grants nothing inside it, and
   * creating a document is not permission to post it.
   */
  test("viewing a budget does not allow approving, rejecting or posting", async () => {
    const viewer = await makeUser({
      permissions: ["MENU_BUDGET_ACCESS", "BUDGET_VIEW"],
    });
    const actor = await actorOf(viewer.id);

    assert.ok(actorCan(actor, "BUDGET_VIEW"));
    assert.equal(actorCan(actor, "BUDGET_CREATE"), false);
    assert.equal(actorCan(actor, "BUDGET_EDIT"), false);
    assert.equal(actorCan(actor, "BUDGET_APPROVE"), false);
    assert.equal(actorCan(actor, "BUDGET_REJECT"), false);
  });

  test("approving does not imply rejecting", async () => {
    const approver = await makeUser({
      permissions: ["MENU_BUDGET_ACCESS", "BUDGET_VIEW", "BUDGET_APPROVE"],
    });
    const actor = await actorOf(approver.id);

    assert.ok(actorCan(actor, "BUDGET_APPROVE"));
    assert.equal(actorCan(actor, "BUDGET_REJECT"), false);
  });

  test("creating a cash bank transaction does not allow posting it", async () => {
    const clerk = await makeUser({
      permissions: [
        "MENU_FINANCE_ACCESS",
        "CASH_BANK_TRANSACTION_VIEW",
        "CASH_BANK_TRANSACTION_CREATE",
      ],
    });
    const actor = await actorOf(clerk.id);

    assert.ok(actorCan(actor, "CASH_BANK_TRANSACTION_CREATE"));
    assert.equal(actorCan(actor, "CASH_BANK_TRANSACTION_POST"), false);
    assert.equal(actorCan(actor, "CASH_BANK_TRANSACTION_CANCEL"), false);
  });

  test("menu access alone grants nothing inside the module", async () => {
    const wanderer = await makeUser({ permissions: ["MENU_FINANCE_ACCESS"] });
    const actor = await actorOf(wanderer.id);

    assert.ok(actorCan(actor, "MENU_FINANCE_ACCESS"));
    assert.equal(actorCan(actor, "CASH_BANK_TRANSACTION_VIEW"), false);
  });

  test("a deactivated role withdraws its permissions without touching assignments", async () => {
    const user = await makeUser({ permissions: ["BUDGET_VIEW", "BUDGET_APPROVE"] });
    const before = await actorOf(user.id);
    assert.ok(actorCanAll(before, ["BUDGET_VIEW", "BUDGET_APPROVE"]));

    const { prisma } = await import("./helpers");
    const assignment = await prisma.sysUserRole.findFirstOrThrow({
      where: { user_id: user.id },
    });
    await prisma.sysRole.update({
      where: { id: assignment.role_id },
      data: { status: "Inactive" },
    });

    const after = await actorOf(user.id);
    assert.equal(actorCan(after, "BUDGET_VIEW"), false);
    assert.equal(
      await prisma.sysUserRole.count({ where: { user_id: user.id } }),
      1,
      "the assignment itself must survive"
    );
  });
});
