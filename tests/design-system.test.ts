import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  orderForHeader,
  type ActionTone,
} from "../src/lib/siba/header-actions";
import {
  BUDGET_TRANSITIONS,
  availableActions,
  type BudgetStatus,
} from "../src/lib/siba/budget-workflow";
import {
  TRANSACTION_TRANSITIONS,
  availableTransactionActions,
} from "../src/lib/siba/transaction-workflow";

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

  test("only `ui/anchored-popup.tsx` places a popup over the page", () => {
    const bad = files.filter(
      (f) =>
        !f.rel.endsWith("ui/anchored-popup.tsx") &&
        /<div[^>]*className=\{?"?cbpop/.test(code(f.text))
    );
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "Render a dropdown through `AnchoredPopup`: a popup drawn inside its control is clipped by whatever scrolls around it, which is what made a dialog scroll instead of its own list."
    );
  });

  test("nothing anchors a popup to its own control's box", () => {
    const bad = files.filter((f) =>
      /(top|bottom):\s*"calc\(100%/.test(code(f.text))
    );
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "`top: calc(100% + 4px)` positions a popup inside the control, so a scrolling ancestor clips it. `AnchoredPopup` places it in viewport coordinates instead."
    );
  });

  test("a popup is positioned in viewport coordinates", () => {
    const rule = css.match(/^\.cbpop\{([^}]*)\}/m);
    assert.ok(rule, "`.cbpop` should still declare the popup's own box.");
    assert.match(
      rule![1],
      /position:fixed/,
      "`.cbpop` must stay `position:fixed` — absolute would put it back inside the dialog body's scroll box."
    );
    assert.doesNotMatch(
      css,
      /^\.cal\{[^}]*position:absolute/m,
      "The calendar takes its position from `AnchoredPopup`, like every other popup."
    );
  });

  test("a grouped list's heading is drawn by `Select`, and it sticks", () => {
    const bad = files.filter(
      (f) =>
        !f.rel.endsWith("ui/select.tsx") &&
        /className=\{?"?cbgh/.test(code(f.text))
    );
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "Group a dropdown by passing `group` on its options — a list that draws its own headings is a second dropdown."
    );

    const rule = css.match(/^\.cbpop \.cbgh\{([^}]*)\}/m);
    assert.ok(rule, "`.cbpop .cbgh` should declare the group heading's box.");
    assert.match(
      rule![1],
      /position:sticky/,
      "A group heading that scrolls away is not a landmark — it must stay on screen while its own rows are read."
    );
    assert.match(
      rule![1],
      /background:/,
      "It needs an opaque background, or the rows scroll through it."
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

  test("a kurs is rendered by `formatRate`, never by a decimal count", () => {
    // Seven screens each passed `formatNumber(rate, 2)` and one passed
    // `formatNumber(rate, 6)`, so the Cash & Bank master showed a kurs to six
    // places while every report showed the same kurs to two. Nothing broke —
    // the application just disagreed with itself about what a rate looks like,
    // which is exactly the drift this suite exists to catch.
    const bad = files.filter(
      (f) =>
        !f.rel.endsWith("lib/format.ts") &&
        /formatNumber\([^)]*\b(rate|Rate|kurs|exchange_rate)\b[^)]*\)/.test(
          code(f.text)
        )
    );
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "Use `formatRate` — one rule for how many decimals a kurs shows, rather than a number chosen per screen."
    );
  });

  test("a foreign amount and its kurs are written by `formatForeignFace`", () => {
    // The Journal rendered the pair with a middot between its halves and the
    // General Ledger with an `@`, so the same fact read two ways on two
    // screens that link to each other. `@` says what the second figure is —
    // a price, not another item in a list — and one function is what keeps it
    // saying that on every screen it appears on.
    const bad = files.filter(
      (f) =>
        !f.rel.endsWith("lib/format.ts") &&
        /formatMoney\([^)]*\btrx(Amount|_amount)\b/.test(code(f.text))
    );
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "Use `formatForeignFace(amount, currencyLabel, rate)` — the transaction-currency face of a base figure is one phrase, not two calls each screen composes itself."
    );
  });
});

describe("a header's buttons sit where the user last left them", () => {
  /** The `.ph-act` blocks in a file, as raw JSX text. */
  function headerBlocks(text: string): string[] {
    const out: string[] = [];
    const src = code(text);
    for (const m of src.matchAll(/<div className="ph-act"\s*>/g)) {
      // Balance the div nesting rather than matching the first </div>: the
      // blocks hold conditional fragments several levels deep.
      let depth = 1;
      let i = m.index! + m[0].length;
      const start = i;
      while (depth > 0 && i < src.length) {
        const open = src.indexOf("<div", i);
        const close = src.indexOf("</div>", i);
        if (close === -1) break;
        if (open !== -1 && open < close) {
          depth += 1;
          i = open + 4;
        } else {
          depth -= 1;
          i = close + 6;
        }
      }
      out.push(src.slice(start, i));
    }
    return out;
  }

  test("no page header writes a danger button after its primary", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const block of headerBlocks(f.text)) {
        const primary = block.indexOf("btn primary");
        const danger = block.lastIndexOf("btn danger");
        if (primary !== -1 && danger > primary) bad.push(f.rel);
      }
    }
    assert.deepEqual(
      [...new Set(bad)],
      [],
      "In `.ph-act` the order is danger, then neutral, then the one primary — " +
        "so what refuses is on the left and what completes is on the right. " +
        "Order the markup, not with CSS `order`: `order` moves a button on " +
        "screen without moving it in the document, and the tab order would " +
        "stop matching what a keyboard user sees."
    );
  });

  test("a lifecycle button's tone comes from its transition table", () => {
    const bad = files.filter((f) =>
      /btn\$\{[^}]*\bdanger\b/.test(code(f.text))
    );
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "Use `headerButtonClass(t.tone)` from `lib/siba/header-actions.ts`. " +
        "Deciding a button's weight inline — `t.danger ? \" danger\" : a === \"approve\" ? \" primary\" : \"\"` — " +
        "is how the primary ended up left of the danger on one status and right of it on the next."
    );
  });

  test("every lifecycle transition declares a tone", () => {
    for (const rel of [
      "src/lib/siba/budget-workflow.ts",
      "src/lib/siba/transaction-workflow.ts",
      "src/lib/siba/fiscal-workflow.ts",
    ]) {
      const text = code(files.find((f) => f.rel === rel)!.text);
      const labels = [...text.matchAll(/^\s{4}label:/gm)].length;
      const tones = [...text.matchAll(/^\s{4}tone:/gm)].length;
      assert.equal(
        tones,
        labels,
        `${rel}: every transition needs a \`tone\`, which is what decides both ` +
          "where its button sits in `.ph-act` and how it is drawn."
      );
    }
  });

  test("a header that mixes tones orders them through `orderForHeader`", () => {
    // These two render Ubah beside the lifecycle actions, so the order is a
    // sort rather than the order the transition table happens to be read in.
    for (const rel of [
      "src/components/budget/budget-form.tsx",
      "src/components/finance/transaction-form.tsx",
    ]) {
      const text = code(files.find((f) => f.rel === rel)!.text);
      assert.ok(
        text.includes("orderForHeader("),
        `${rel}: order the header with \`orderForHeader\`. \`availableActions\` ` +
          "returns menu order — safe first, danger last — which is the right " +
          "arrangement for the vertical row menu and the wrong one here."
      );
    }
  });
});

describe("the header order each status actually produces", () => {
  /**
   * The statuses a browser cannot be walked through without creating records
   * in a live database — the application has no delete, so a Draft made to
   * look at is a Draft that stays. Pinned here instead: the tones are what
   * `orderForHeader` sorts on, so this is the same decision the header makes.
   *
   * Ubah is neutral wherever a lifecycle action is offered beside it, which is
   * why it lands between what refuses and what completes.
   */
  const ubah = { key: "edit", tone: "neutral" as ActionTone };

  /** Holding everything, so the order is the table's and not a permission's. */
  const EVERY_TRANSACTION_ABILITY = {
    create: true,
    edit: true,
    submit: true,
    post: true,
    cancel: true,
  };

  const budgetHeader = (status: BudgetStatus, editable: boolean) =>
    orderForHeader(
      [
        ...(editable ? [ubah] : []),
        ...availableActions(status, {
          create: true,
          edit: true,
          submit: true,
          approve: true,
          reject: true,
          cancel: true,
        }).map((a) => ({ key: a, tone: BUDGET_TRANSITIONS[a].tone })),
      ],
      (i) => i.tone
    ).map((i) => i.key);

  test("a Draft budget reads Batalkan · Ubah · Ajukan", () => {
    assert.deepEqual(budgetHeader("Draft", true), ["cancel", "edit", "submit"]);
  });

  test("a Rejected budget reads Batalkan · Ubah · Ajukan", () => {
    assert.deepEqual(budgetHeader("Rejected", true), [
      "cancel",
      "edit",
      "submit",
    ]);
  });

  test("a Submitted budget reads Tolak · Batalkan · Setujui", () => {
    assert.deepEqual(budgetHeader("Submitted", false), [
      "reject",
      "cancel",
      "approve",
    ]);
  });

  test("an Open budget offers nothing, and so shows nothing", () => {
    assert.deepEqual(budgetHeader("Open", false), []);
  });

  test("a Draft document reads Batalkan · Ubah · Post", () => {
    const order = orderForHeader(
      [
        ubah,
        ...availableTransactionActions("Draft", EVERY_TRANSACTION_ABILITY).map(
          (a) => ({ key: a, tone: TRANSACTION_TRANSITIONS[a].tone })
        ),
      ],
      (i) => i.tone
    ).map((i) => i.key);
    assert.deepEqual(order, ["cancel", "edit", "post"]);
  });

  test("a Draft anak document reads Batalkan · Ubah · Ajukan Dana", () => {
    const order = orderForHeader(
      [
        ubah,
        ...availableTransactionActions("Draft", EVERY_TRANSACTION_ABILITY, {
          funded: true,
        }).map((a) => ({ key: a, tone: TRANSACTION_TRANSITIONS[a].tone })),
      ],
      (i) => i.tone
    ).map((i) => i.key);
    assert.deepEqual(order, ["cancel", "edit", "submit"]);
  });

  test("a Pending document offers only the withdrawal", () => {
    // The induk never rejects (concept doc §29), so Post is not on this screen
    // at all — it is reached by confirming the Funding Request.
    assert.deepEqual(
      availableTransactionActions("Pending", EVERY_TRANSACTION_ABILITY, {
        funded: true,
      }),
      ["cancel"]
    );
  });

  test("two buttons of one tone keep the order their table declares", () => {
    // Tolak before Batalkan because `availableActions` reads them that way —
    // a stable sort, so equal tones are never shuffled between renders.
    assert.deepEqual(
      orderForHeader(
        [
          { key: "approve", tone: "primary" as ActionTone },
          { key: "reject", tone: "danger" as ActionTone },
          { key: "cancel", tone: "danger" as ActionTone },
        ],
        (i) => i.tone
      ).map((i) => i.key),
      ["reject", "cancel", "approve"]
    );
  });
});

describe("a form is laid out by one component", () => {
  const FORM = "src/components/ui/form.tsx";

  test("a labelled field goes through `ui/form.tsx`", () => {
    // A hand-written `.fld` that carries a `<label>` is a field, and a field is
    // what `Field` is for — it decides the label, the required star, the lock
    // badge, where the help sits and where the error goes. Five files each kept
    // their own copy of that, which is how the same control came to present
    // three different ways. A label-less `.fld` is a layout slot (a button, an
    // error banner, a checkbox grid) and stays allowed.
    const bad = files
      .filter((f) => f.rel !== FORM)
      .filter((f) =>
        // A bare `<label>` (or one carrying only `htmlFor`) is a field's label.
        // `<label className="…">` is a control in its own right — a checkbox
        // row, a toggle — and is not what `Field` replaces.
        /className="fld[^"]*">(?:[^<]|<(?!\/div))*?<label(?:\s+htmlFor=[^>]*)?>/.test(
          code(f.text)
        )
      );
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      `A field with a label belongs to <Field> from ${FORM}, not to hand-written markup.`
    );
  });

  test("only `ui/form.tsx` builds a form section or row", () => {
    const bad = files
      .filter((f) => f.rel !== FORM)
      .filter((f) => /className="(fsec|sec-t|fbody)"/.test(code(f.text)));
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      `Use <FormSection> / <FormBody> from ${FORM} rather than emitting its classes.`
    );
  });

  test("help text is written by `Field`, never beside a control", () => {
    // Help shares the label's line now. A `.help` div rendered next to a
    // control would sit under it again, which is the 21px per field this
    // layout exists to stop paying.
    const allowed = new Set([
      FORM,
      // Standalone notes, not a field's help: why a Role is frozen, and why an
      // administrator cannot change their own roles.
      "src/components/settings/role-form.tsx",
      "src/components/settings/user-form.tsx",
      "src/components/budget/report-picker.tsx",
    ]);
    const bad = files
      .filter((f) => !allowed.has(f.rel))
      .filter((f) => /className="help"/.test(code(f.text)));
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "Pass a help prop to <Field> instead of rendering a .help div."
    );
  });

  test("no form page carries a `.ph-sub`", () => {
    // A form's subtitle restated the card header 40px below it. Lists and the
    // dashboard keep theirs: there, the sentence says what the table is of.
    const forms = files.filter((f) => /-form\.tsx$|profile-view\.tsx$|funding-detail\.tsx$|journal-detail\.tsx$/.test(f.rel));
    const bad = forms.filter((f) => /className="ph-sub"/.test(code(f.text)));
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "A form states its purpose in its card header, not in a page subtitle."
    );
  });

  test("no form keeps a summary side card", () => {
    // Its facts went where each is read: the number and the status into the
    // page heading, the authorship into the record's own history panel.
    const bad = files.filter((f) => /className="card side"/.test(code(f.text)));
    assert.deepEqual(
      bad.map((f) => f.rel),
      [],
      "A summary card collects leftovers; put each fact where it is read."
    );
  });

  test("a document heading is the document number", () => {
    // Every document screen names itself the same way, so `.docno` is what the
    // heading of a record-bearing form contains.
    for (const rel of [
      "src/components/budget/budget-form.tsx",
      "src/components/finance/transaction-form.tsx",
      "src/components/finance/funding-detail.tsx",
      "src/components/accounting/journal-detail.tsx",
    ]) {
      const f = files.find((x) => x.rel === rel);
      assert.ok(f, `${rel} is missing`);
      assert.match(
        code(f!.text),
        /className="docno"/,
        `${rel} should title itself with its document number.`
      );
    }
  });
});
