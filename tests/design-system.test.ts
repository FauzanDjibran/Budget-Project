import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The design system holds together, checked mechanically.
 *
 * CLAUDE.md §8 and §12 already say a control is drawn by the application and
 * never by the operating system, that a page header's rules are scoped
 * `.pad > .ph`, and that an amount is grouped in thousands wherever it is
 * typed. Prose cannot enforce any of that: none of these mistakes breaks a
 * build, fails a type check, or throws at runtime — they just quietly make one
 * screen behave unlike the rest, which is the failure this suite exists to
 * catch. Every assertion here corresponds to a discrepancy that actually
 * reached the running application.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "generated") continue;
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const files = sourceFiles().map((path) => ({
  path,
  rel: path.slice(process.cwd().length + 1).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));

/** Code, with block comments and `//` lines removed — the docs discuss these. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");

describe("no control is drawn by the operating system", () => {
  test("nothing renders a native <select>", () => {
    const bad = files.filter((f) => /<select[\s>]/.test(code(f.text)));
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "Use `components/ui/select.tsx` — a native <select> draws its list in the OS's own typography."
    );
  });

  test("nothing renders a native date input", () => {
    const bad = files.filter((f) => /type=["']date["']/.test(code(f.text)));
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "Use `components/ui/date-input.tsx` — <input type=\"date\"> renders in the browser's locale, so the same form reads mm/dd/yyyy to one user and dd/mm/yyyy to another."
    );
  });

  test("nothing renders a native number input", () => {
    const bad = files.filter((f) => /type=["']number["']/.test(code(f.text)));
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "Use `components/ui/money-input.tsx` — <input type=\"number\"> carries an OS spinner, left-aligns the figure and cannot group thousands."
    );
  });
});

describe("the page header cannot leak onto a placeholder", () => {
  /**
   * `.ph` is the page header *and* the placeholder inside Combobox, Select and
   * DateInput. A bare `.ph{margin-bottom:15px}` shipped for months and put 15px
   * under every dropdown placeholder in the application, pushing the text half
   * a line above the caret beside it on every filter and every form.
   */
  test("globals.css declares no bare `.ph` rule", () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const bare: string[] = [];
    for (const [, selectors] of stripped.matchAll(/([^{}]+)\{/g)) {
      for (const one of selectors.split(",")) {
        // Bare means the whole compound is `.ph` — `.pad > .ph` and `.cbx .ph`
        // both say which `.ph` they mean, and are exactly the right shape.
        if (one.replace(/\s+/g, " ").trim() === ".ph") bare.push(selectors.trim());
      }
    }
    assert.deepEqual(
      bare,
      [],
      "Scope page-header rules to `.pad > .ph`: `.ph` is also the placeholder class inside a Combobox, a Select and a DateInput."
    );
  });
});

describe("one way to do each thing", () => {
  test("only `ui/search-field.tsx` builds a list's search box", () => {
    const bad = files.filter(
      (f) =>
        !f.rel.endsWith("ui/search-field.tsx") &&
        /className=\{?`?srch/.test(code(f.text))
    );
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "Use `SearchField` — seven lists once carried their own copy of this markup."
    );
  });

  test("only `ui/dialog.tsx` and `ui/confirm-dialog.tsx` build a dialog", () => {
    const bad = files.filter(
      (f) =>
        !/ui\/(confirm-)?dialog\.tsx$/.test(f.rel) &&
        /className="ovl"/.test(code(f.text))
    );
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "Use `Dialog` for a panel and `ConfirmDialog` for a question — four dialogs once drew their own header out of inline styles."
    );
  });

  test("a tinted dialog icon takes its tone from a class", () => {
    const bad = files.filter((f) =>
      /className="mi"\s*\n?\s*style=/.test(code(f.text))
    );
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "Use `.mi.t-ok` / `.t-bad` / `.t-brand` / `.t-warn` rather than writing the background and colour by hand."
    );
  });
});

describe("dates and money are formatted in one place", () => {
  test("nothing formats a number or a date outside `lib/format.ts`", () => {
    const bad = files.filter(
      (f) =>
        !f.rel.endsWith("lib/format.ts") &&
        /toLocaleDateString|toLocaleString\(/.test(code(f.text))
    );
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "Use `formatDate`, `formatNumber` and `formatMoney` — they are what keep every date dd/mm/yyyy and every amount grouped."
    );
  });
});
