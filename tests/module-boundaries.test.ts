import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Module boundaries hold, checked mechanically.
 *
 * SIBA is one deployable unit, but each module is meant to behave as a
 * building block that could be replaced or lifted out — which is only true
 * while modules talk to each other through named functions rather than
 * reaching into each other's tables. Nothing here breaks a build or a type
 * check when it erodes, which is exactly why it erodes: `finance.ts` read and
 * wrote `bud_budget` directly for as long as Finance had existed, and the
 * import graph looked clean the whole time because it bypassed `budget.ts`
 * altogether and went to the Prisma delegate.
 *
 * This is a source-text scan, like `design-system.test.ts`. It needs no
 * database and costs nothing to run.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "generated") continue;
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const relPath = (path: string) =>
  path.slice(process.cwd().length + 1).replaceAll("\\", "/");

const files = sourceFiles(SRC).map((path) => ({
  path,
  rel: relPath(path),
  text: readFileSync(path, "utf8"),
}));

/** Code, with block comments and `//` lines removed — the docs name these. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const sibaModule = (name: string) =>
  files.find((f) => f.rel === `src/lib/siba/${name}.ts`)!;

/** The `./x` and `@/lib/siba/x` modules a file imports. */
function sibaImports(text: string): string[] {
  const out = new Set<string>();
  for (const m of code(text).matchAll(/from\s+"\.\/([a-z-]+)"/g)) out.add(m[1]);
  for (const m of code(text).matchAll(/from\s+"@\/lib\/siba\/([a-z-]+)"/g)) {
    out.add(m[1]);
  }
  return [...out];
}

// ------------------------------------------------------------ table owners

/**
 * Who may name a Prisma delegate.
 *
 * Only tables with a real owner are listed. `records.ts` is the registry's
 * generic reader and deliberately reaches many tables, so master tables are
 * left unconstrained — the rule is about a module's *own* records, not about
 * every query in the application.
 */
const TABLE_OWNERS: Record<string, string[]> = {
  // A module is its data module *and* its Server Action — two layers of one
  // building block, not two modules.
  budBudget: ["src/lib/siba/budget.ts", "src/app/actions/budget.ts"],
  finCashBankTransaction: [
    "src/lib/siba/finance.ts",
    "src/app/actions/finance.ts",
  ],
  finCashBankTransactionLine: [
    "src/lib/siba/finance.ts",
    "src/app/actions/finance.ts",
  ],
  finFundingRequest: ["src/lib/siba/funding.ts", "src/app/actions/funding.ts"],
  cashBankLedger: ["src/lib/siba/cash-bank.ts"],
  cashBankBalance: ["src/lib/siba/cash-bank.ts"],
  subLedger: ["src/lib/siba/subledger.ts"],
  subLedgerBalance: ["src/lib/siba/subledger.ts"],
  // The General Ledger is the one thing that may derive from journal lines
  // (CLAUDE.md §10 rule 22) — it reads them and never writes one.
  accJournal: ["src/lib/siba/journal.ts", "src/lib/siba/ledger.ts"],
  accJournalLine: ["src/lib/siba/journal.ts", "src/lib/siba/ledger.ts"],
};

/**
 * Boundaries still crossed today — baselined, not blessed.
 *
 * Each of these is a real crossing that predates this suite. They are listed
 * so the test can be introduced without a red build, and so that the debt is
 * written down precisely rather than discovered again later. Closing each one
 * is a design decision in its own right, which is why none of them was quietly
 * "fixed" while the suite was being written:
 *
 *  - `fiscal.ts` counts the Budgets falling inside each period it returns.
 *    Accounting reaching into Budget; wants a counting function on `budget.ts`.
 *  - `cash-bank.ts` resolves a ledger entry's source document to a document
 *    number for the ledger report. The hard one: the Book is meant to be a
 *    leaf, so it cannot simply import Finance — that would be a cycle. The
 *    real answer is likely that labelling a `(doc_type_id, doc_id)` pair
 *    belongs to the caller, not to the book.
 *
 * Nothing may be added to this list without the same deliberation. A new
 * crossing fails the suite, which is the point.
 */
const KNOWN_CROSSINGS: Record<string, string[]> = {
  budBudget: ["src/lib/siba/fiscal.ts"],
  finCashBankTransaction: ["src/lib/siba/cash-bank.ts"],
};

describe("a module's tables are named only by the module that owns them", () => {
  for (const [delegate, owners] of Object.entries(TABLE_OWNERS)) {
    test(`${delegate} is reached only through ${owners.join(" / ")}`, () => {
      // String.raw, so the backslashes reach the RegExp rather than being read
      // as string escapes — `\b` in a plain template literal is a backspace.
      const pattern = new RegExp(
        String.raw`\b(?:prisma|tx|db)\.${delegate}\b`
      );
      const allowed = [...owners, ...(KNOWN_CROSSINGS[delegate] ?? [])];
      const trespassers = files
        .filter((f) => !allowed.includes(f.rel))
        .filter((f) => pattern.test(code(f.text)))
        .map((f) => f.rel);

      assert.deepEqual(
        trespassers,
        [],
        `${delegate} belongs to ${owners.join(", ")}. Add a function there and call it, ` +
          "rather than querying another module's table — a boundary crossed in one " +
          "direction becomes a boundary crossed in both."
      );
    });
  }
});

// -------------------------------------------------------- import direction

describe("the dependency graph points one way", () => {
  test("budget.ts does not import finance.ts", () => {
    assert.ok(
      !sibaImports(sibaModule("budget").text).includes("finance"),
      "Finance executes what Budget plans, so Finance may depend on Budget and never " +
        "the reverse. A plan is complete without an execution."
    );
  });

  test("finance.ts does not import funding.ts", () => {
    // Funding is how the anak's cash arrives, not what the realization *is*:
    // a Cash Bank Transaction is complete without one, exactly as a Budget is
    // complete without a realization. Funding therefore reads documents and
    // moves their status through functions Finance exports, and Finance names
    // nothing here — which is also what keeps the confirmation able to write
    // both Companies inside one transaction that Funding owns.
    assert.ok(
      !sibaImports(sibaModule("finance").text).includes("funding"),
      "Funding depends on Finance, never the reverse. Export what Funding needs " +
        "from finance.ts instead of reaching back into it."
    );
  });

  test("the books depend on no domain module", () => {
    // `cash_bank_ledger` and `acc_journal` are independent historical stores
    // (concept doc §2.5). A book that imported its writer could not be lifted
    // out, and would invite being derived from it.
    const KERNEL = [
      "document-number",
      "period",
      "account-code",
      "permissions",
      // A book's own catalogue: which books exist and which way each one
      // moves. Client-safe, database-free, and declared by the book itself.
      "subledger-catalogue",
    ];
    for (const book of ["cash-bank", "journal", "subledger"]) {
      const leaked = sibaImports(sibaModule(book).text).filter(
        (d) => !KERNEL.includes(d)
      );
      assert.deepEqual(
        leaked,
        [],
        `${book}.ts may import only shared-kernel modules (${KERNEL.join(", ")}). ` +
          "A book is written by callers; it never reaches back to them."
      );
    }
  });

  test("PeriodRange is not taken from the Cash Bank Book", () => {
    const bad = files
      .filter((f) =>
        /PeriodRange[\s\S]{0,80}from\s+"[^"]*cash-bank"|from\s+"[^"]*cash-bank"[^;]*PeriodRange/.test(
          code(f.text)
        )
      )
      .map((f) => f.rel);
    assert.deepEqual(
      bad,
      [],
      "Import PeriodRange from `lib/siba/period` — the General Ledger and the " +
        "Accounting report route should not depend on the Cash Bank Book for a type."
    );
  });
});

// ----------------------------------------------------------------- the UI

describe("module UI follows the same direction as its data", () => {
  test("components/budget does not import components/finance", () => {
    const bad = files
      .filter((f) => f.rel.startsWith("src/components/budget/"))
      .filter((f) => /from\s+"@\/components\/finance\//.test(code(f.text)))
      .map((f) => f.rel);
    assert.deepEqual(
      bad,
      [],
      "Finance's screens may reuse Budget's; Budget's must not reach into Finance's, " +
        "for the same reason `budget.ts` does not import `finance.ts`."
    );
  });
});

// ------------------------------------------------------------- numbering

describe("document numbers come from one place", () => {
  test("nothing builds its own document number", () => {
    // Only the document form, `PREFIX-0001`. The `<prefix>.<4 digits>` system
    // code that `nextCode()` produces for master records is a separate
    // convention on purpose (CLAUDE.md §9) and is left alone here.
    const handRolled = /-\$\{String\([^}]*\)\.padStart\(\s*4\s*,\s*"0"\s*\)\}/;
    const bad = files
      .filter((f) => f.rel !== "src/lib/siba/document-number.ts")
      .filter((f) => handRolled.test(code(f.text)))
      .map((f) => f.rel);
    assert.deepEqual(
      bad,
      [],
      "Use `nextDocumentNumber` from `lib/siba/document-number` — four modules " +
        "previously carried their own copy of this, two of which loaded every row " +
        "in the table to find a maximum."
    );
  });
});
