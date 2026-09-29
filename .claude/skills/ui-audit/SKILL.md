---
name: ui-audit
description: Compare a changed SIBA screen against the screen it should look like, before reporting UI work done. Use whenever a change adds or alters a page, a form, a list or a report — "check the design", "does this match the other menus", "audit the UI", "run it by the design convention" — and before saying any UI change is finished. Screenshots each screen beside its reference and prints the structural differences (breadcrumb, heading, card headings, columns, mono amounts, row actions, pager, filters, notes, Riwayat).
---

# UI audit

The design-system suite (`tests/design-system.test.ts`) reads source text. It
catches a control copied by hand, but not a screen that is tidy on its own and
still unlike the rest — which is how the Journal ended up with a view page
without card headings, figures in the body font, an edit page without Riwayat
and a register without a `No` column, while every test passed. This skill is
the step that looks at the rendered screens side by side.

## 1. Choose the pairs

Every changed screen is compared with the **nearest finished screen of the same
kind** — never with itself.

| Changed screen | Reference |
| --- | --- |
| A document register | `/finance/debit-credit-note` |
| A document, view | `/finance/debit-credit-note/<id>` (a Draft) |
| A document, edit | `/finance/debit-credit-note/<id>/edit` |
| A document, new | `/finance/debit-credit-note/new` |
| A master list / form | `/master/partner`, `/master/partner/<id>` |
| A Report View | `/accounting/report/balance-sheet` for a statement, `/finance/report/cash-bank-ledger` for a book |

Take real ids from the database (`psql … -c "select id, status from fin_dncn"`).
A screen with nothing on it cannot be judged, so the database needs the
showcase (`npm run db:seed-showcase`) — never on data the user cares about.

## 2. Run it

The app must be serving the build that contains the change (`npm run build`,
then `npm start` — the `run-siba` skill). Then:

```bash
node .claude/skills/ui-audit/audit.mjs <scratch-dir> \
  /accounting/journal /finance/debit-credit-note \
  /accounting/journal/213 /finance/debit-credit-note/19
```

It needs `playwright` resolvable. Locally, `npx -y playwright@latest` provides
it; in a cloud container, install it into the scratchpad
(`npm i playwright --prefix <scratch>/pw`) and run the script from there — do not
add it to the project's dependencies, and do not run `playwright install`
(Chromium is already at `/opt/pw-browsers`).

## 3. Read it

Each pair prints one line per landmark; `≠` marks a difference. Then **open both
PNGs** and look — the text is a checklist, not the judgement.

A difference is either:

- **a defect** — fix it, or
- **what the screen genuinely is** (a register with no lifecycle has no row
  menu; a read-only document has no Tambah Baris) — say so in the report.

Never report "matches the convention" for a screen that has an unexplained `≠`.

## 4. Make it stay fixed

A defect found here that could recur is a missing assertion. Add it to
`tests/design-system.test.ts` — for a document screen, by listing the document in
`DOCUMENT_SCREENS`, which holds the shape (`DocumentHeader`, view and edit as one
component with Riwayat on both, the register's `No` / `Status:` / `.ract` /
Pager, `Amount` in cells, no raw status). Check the new assertion **fails on the
old code** before relying on it.
