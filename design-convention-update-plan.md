# SIBA 3.0 — Design Convention Update Plan

> **What this is.** A plan to bring SIBA's UI in line with the shared design
> convention (`D:\Claude Code\Good Concept\design-convention.md`, §13.1,
> decisions D1–D22, approved 24 September 2026). SIBA is that convention's
> reference implementation, and today it breaks 20 of the 22 decisions.
>
> **Status: proposed. Nothing in it has been done.** Executing it changes
> application code and several frozen decisions in `CLAUDE.md`, so it needs an
> explicit go-ahead first. The go-ahead can cover the whole plan or single work
> packages.
>
> **Ground rules for execution:**
> - One commit per work package, on `main` (CLAUDE.md §16).
> - Each work package updates `CLAUDE.md` in the same commit wherever it
>   changes a recorded convention (CLAUDE.md §19).
> - Each work package adds a guard to `tests/design-system.test.ts`, so the
>   inconsistency it removes cannot come back.
> - No database change, so no migration and no DBML update.

---

## 1. Overview

| WP | Area | Decisions | Size | Changes behaviour a user sees? |
|---|---|---|---|---|
| 1 | Shared components | D1, D4, D7, D11, D18, D20 (building blocks) | M | No (new components only) |
| 2 | Lists | D1, D2, D9 (KPI), D11, D15, D18, D19 | M | Yes: pager, filter labels, more lists paged |
| 3 | Forms & detail pages | D3, D4, D12, D13, D14, D20 | M | **Yes: status button replaces the clickable badge; confirmation on Batal** |
| 4 | Reports, tree & menu | D6, D7, D8 | S | Yes: Accounting menu regrouped; the tree's expand buttons move |
| 5 | Shell & breadcrumb | D5, D17 | M | Yes: navigation works at 860px or narrower |
| 6 | Clean-up | D9 (rest), D10, D16 | S | No (visual parity) |
| 7 | Documentation close-out | all | S | No |

**Order.** Run WP1 first; the others depend on its components. After that,
WP2–WP6 can run in any order. WP7 closes out. D21 and D22 need no SIBA change.

---

## 2. CLAUDE.md touchpoints

These passages record a convention that a work package changes. Each is
updated **in the same commit** as the code.

| CLAUDE.md passage | Change | WP |
|---|---|---|
| §8 table, row "Unsaved changes" | Add: `Batal` asks for confirmation while the form is dirty | 3 |
| §8 table, row "Row menus" / §12 "A header's buttons are ordered…" | Add the master-record header orders: `Nonaktifkan · Ubah`, `Aktifkan · Ubah`, `Nonaktifkan · Reset Password · Ubah`. The status badge is display only | 3 |
| §8 table, new row "Pagination" | Current page only; every list that grows with use is paged; one `Pager` component | 2 |
| §8 table, new row "Expand all" | A Buka + Tutup pair in the bar above the content, never in `.ph-act` | 4 |
| §8 table, row "Responsive" | Say the burger exists at 860px | 5 |
| §12 "Design system lifted verbatim" | Record that unused rules were removed by decision D16. "Near-unmodified" no longer covers them | 6 |
| §12 "A repeated control is a component…" | Add `Pager`, `CancelButton`, `ExpandAll` to the list of components | 1 |
| §12 "A subject book is a Budget Category", clause "Menu placement…" | Accounting reports now also sit in a *Laporan* group | 4 |
| §5 repository structure, `components/ui/` line | Add the three new components | 1 |
| §17 known issues | No row is added or removed. Checked: none of D1–D20 appears there | — |

---

## 3. Work packages

### WP1 — Shared components (building blocks)

Every later work package uses these. This package changes no screen.

#### 1a. `components/ui/pager.tsx` (for D1, D11)
- **Props:** `page`, `pages`, `total`, `perPage`, `onPage`, `onPerPage`.
- **Renders:** `.pager` → `.inf` "Halaman **x** dari **y** (n total)" → a
  compact `Select` "Tampil 10/25/50/100" → `.pgs` with `« ‹`,
  `<span class="pg on">x</span>`, `› »`.
- **Guard:** only `ui/pager.tsx` may render `className="pager"`; no file may
  contain `pg act`.

#### 1b. `components/ui/cancel-button.tsx` (for D4, D20)
- **Props:** `href` **or** `onCancel`, and `dirty`.
- **Renders:** `.btn` with the `back` icon and the text `Batal`.
- **When `dirty`:** clicking opens a `ConfirmDialog`:
  - icon `warn`, tone `danger`;
  - title "Konfirmasi Buang Perubahan";
  - body "Perubahan yang belum disimpan akan hilang.";
  - confirm "Ya, Buang Perubahan", tone `solid-danger`;
  - on confirm it navigates, or calls `onCancel`.
- **When clean:** it leaves immediately.
- **Guard:** no `*-form.tsx` writes its own `Batal`. Dialog footers are exempt.

#### 1c. `components/ui/expand-all.tsx` (for D7)
- **Props:** `onExpand`, `onCollapse`, optional `allOpen` / `allClosed` to
  disable the button that would do nothing.
- **Renders:** two `btn sm` buttons, `Buka Semua` (`expand` icon) and
  `Tutup Semua` (`collapse` icon).
- **Guard:** only `ui/expand-all.tsx` writes the strings "Buka Semua" and
  "Tutup Semua".

#### 1d. Icons: `more` and `menu` (for D17, D18)
- Add `more` (⋯, three dots) and `menu` (≡, three bars) to
  `components/icon-paths.ts`, drawn in the existing stroke style.

**Verify:** `npm run build`, `npm run lint`, `npm test`.

---

### WP2 — Lists

| # | Decision | Current | Change | Files (`src/components/…`) |
|---|---|---|---|---|
| 2a | D1 pager | The registry list renders every page number; 4 registers render an unstyled `span.pg.act` | Replace every inline pager with `<Pager>` | `master/entity-list.tsx`, `finance/transaction-list.tsx`, `finance/transfer-list.tsx`, `finance/dncn-list.tsx`, `budget/budget-list.tsx` |
| 2b | D11 coverage | 6 lists have no pager | Add client-side paging (default 25) with `<Pager>` | `accounting/journal-list.tsx`, `accounting/opening-balance-list.tsx`, `finance/funding-list.tsx`, `settings/user-list.tsx`, `settings/role-list.tsx`, `budget/budget-month-list.tsx` *(see §6, Q1)* |
| 2c | D2 filter label | "Semua status", compact trigger | "Status: semua", `variant="toolbar"` | `master/entity-list.tsx`, `settings/user-list.tsx` |
| 2d | D18 icon | "Aksi lain" uses `hist` | Use `more` | `finance/transaction-list.tsx`, `transfer-list.tsx`, `dncn-list.tsx`, `budget/budget-list.tsx` |
| 2e | D19 alignment | Registers write an inline 24px spacer; the registry list writes none | Add `.ract .sp{width:24px;display:inline-block}` to `globals.css`. Use it for every absent action, including the registry list's absent `Ubah` and toggle | the 5 list files in 2a |
| 2f | D9 KPI tints | KPI icon tiles use `style={{background, color}}` | Use the existing global tone classes (`className="i t-warn"`, etc.). `.t-ok/.t-warn/.t-info/.t-bad` already set the same background and colour | `finance/transaction-list.tsx`, `transfer-list.tsx`, `dncn-list.tsx`, `funding-list.tsx`, `budget/budget-list.tsx` |
| 2g | D15 footnotes | Register footnotes run to 2–4 sentences | Cut each to the **one** clause that changes how a column is read. Drop restated rules. *Copy is user-facing: the proposed sentences are shown to you before commit* | `budget/budget-list.tsx`, `budget/budget-month-list.tsx`, `finance/dncn-list.tsx`, `funding-list.tsx`, `transaction-list.tsx`, `transfer-list.tsx` |

**Guards:**
- The `<Pager>` rule from 1a.
- The "Aksi lain" trigger uses `name="more"`.
- No `style={{ width: 24` spacer in any list.
- No `label: "Semua ` option in a toolbar filter.

**Verify:**
- In the browser, check every list in 2a and 2b: paging, page size,
  filter-then-reset to page 1, and a single-page list.
- Check that the icon alignment holds down each list.

---

### WP3 — Forms & detail pages

| # | Decision | Current | Change | Files |
|---|---|---|---|---|
| 3a | D3 "Mode Ubah" | `t-vio` on 4 document forms; missing on Budget | `t-warn` everywhere; add the badge to Budget's edit mode | `accounting/journal-form.tsx`, `finance/dncn-form.tsx`, `finance/transaction-form.tsx`, `finance/transfer-form.tsx`, `budget/budget-form.tsx` |
| 3b | D4 + D20 Batal | Text-only `Batal` on 4 forms; no form confirms a discard | Replace every `Batal` with `<CancelButton dirty={dirty}>`. System Default's `Batal` resets rather than navigates, so it uses `onCancel={reset}` | `master/entity-form.tsx`, `budget/budget-form.tsx`, `finance/transaction-form.tsx`, `finance/transfer-form.tsx`, `finance/dncn-form.tsx`, `accounting/journal-form.tsx`, `settings/user-form.tsx`, `settings/role-form.tsx`, `settings/system-default-form.tsx` |
| 3c | D12 container | `.fgrid` without `.solo` | `.fgrid solo`. **First** capture a screenshot at 1600px to confirm the empty 306px column. This was read from the CSS and has not been checked in a browser | `finance/transaction-form.tsx`, `transfer-form.tsx`, `dncn-form.tsx` |
| 3d | D13 locked field | In edit mode a locked field renders its control with `disabled={locked}` | When `locked && editing`, render `readOnlyBody(...)` inside the same `Field`, which keeps its "Terkunci" chip. The Server Action already ignores locked fields, so nothing submitted changes. **Also audit** the document forms for any other disabled-but-locked field | `master/entity-form.tsx` (8 controls), plus the audit |
| 3e | D14 status on detail | Masters: the heading's status badge is a `<button>` that opens the confirmation. User and Role: a **neutral** "Nonaktifkan/Aktifkan" header button | The badge becomes a plain `<span>`. Add a header button: `Nonaktifkan` in danger tone, `Aktifkan` in neutral, `gear` icon, same `ConfirmDialog`. Order the header through `orderForHeader`. User and Role: Nonaktifkan becomes danger, giving `Nonaktifkan · Reset Password · Ubah` | `master/entity-form.tsx`, `settings/user-form.tsx`, `settings/role-form.tsx` |

**Guards:**
- No `<button className={\`bdg` anywhere.
- No `disabled={locked}` in `entity-form.tsx`.
- Every `className="fgrid` is `fgrid solo`.
- Every `Mode Ubah` badge is `t-warn`.
- Pin the master header orders in the header-order block, as the Budget and
  document orders already are.

**Verify, in the browser:**
- Partner and Cash & Bank edit: Company shows as text with "Terkunci".
- Account edit: the locked segment and the inherited code show as text.
- Deactivate, then reactivate, a Currency from its detail page.
- Deactivate a User and a Role.
- Dirty a form and press `Batal`, both ways: confirm, and cancel.
- A clean form's `Batal` leaves immediately.
- System Default: `Batal` resets.

---

### WP4 — Reports, tree & menu

| # | Decision | Current | Change | Files |
|---|---|---|---|---|
| 4a | D6 report group | Accounting's reports sit in the group "Journal & Buku Besar" beside Journal | Split it: the group `journal` keeps Journal only (renamed "Journal"). A new group `{ key: "report", name: "Laporan" }` holds General Ledger, Trial Balance, Laba Rugi, Neraca. Slugs and routes are unchanged | `lib/siba/nav.ts` |
| 4b | D7 tree | Buka/Tutup Semua sit in `.ph-act` | Move them into the card `.toolbar` after the count, as `<ExpandAll>` | `master/account-tree.tsx` |
| 4c | D7 reports | GL and Buku Subjek use one toggle whose label flips | `<ExpandAll>` pair in `.rhead`. The statement report switches to `<ExpandAll>` (it already renders a pair) | `report/general-ledger-report.tsx`, `report/subledger-report.tsx`, `report/statement-report.tsx` |
| 4d | D8 empty size | Two reports use a page-level `.empty` inside the report body | `.empty sm` | `report/trial-balance-report.tsx`, `report/cash-bank-layer-report.tsx` |

**Guards:**
- Every `nav.ts` entity whose slug starts with `report/` is in a group named
  "Laporan". This goes beside the existing test that every menu entry
  resolves.
- `ExpandAll` never appears inside `.ph-act`.
- Files under `components/report/` render only `empty sm`.

**Verify:**
- `tests/reports.test.ts`, which pins navigation resolution.
- In the browser: the Accounting submenu, active-leaf highlighting on a report
  page, the tree's toolbar buttons, GL and Buku Subjek with 1 and with several
  subjects.

---

### WP5 — Shell & breadcrumb

| # | Decision | Current | Change | Files |
|---|---|---|---|---|
| 5a | D5 breadcrumb | 8 components link the module segment to `/dashboard` | Render `<span>{module}</span>`. The entity segment keeps its link to the list | `budget/budget-form.tsx`, `budget/budget-list.tsx`, `budget/budget-locked.tsx`, `budget/budget-month-list.tsx`, `master/account-tree.tsx`, `master/entity-form.tsx`, `master/entity-list.tsx`, `master/entity-locked.tsx` |
| 5b | D17 narrow nav | The ≤860px CSS expects `.tb-burger`, `body.nav-open` and `.scrim`; the shell renders none of them | Render `.tb-burger` (`menu` icon, "Buka menu") first in the topbar. Toggle `nav-open` on `document.body`. Render `.scrim`, which closes on click. Close on route change and on leaf click. **Reconcile:** below 860px the shell's inline width-0 style on the collapsed submenu must not apply, or the panel opens empty | `shell/app-shell.tsx` (plus a CSS tweak only if the reconciliation needs one) |

**Guards:**
- No `href="/dashboard"` inside a `.crumb`.
- `app-shell.tsx` renders `tb-burger` and `scrim`.

**Verify:**
- Resize to the mobile preset (375px) and 800px: open, navigate, close by
  scrim, close by leaf.
- Back at desktop width: the burger is hidden and the submenu collapse still
  works.

---

### WP6 — Clean-up

| # | Decision | Change | Files |
|---|---|---|---|
| 6a | D9 remaining tints | Replace the remaining inline tints with tone classes, with the same visual result | `dashboard/dashboard.tsx` (4), `accounting/fiscal-periods.tsx`, `master/cash-bank-book-card.tsx`, `auth/access-denied.tsx` |
| 6b | D10 icon | `NoCompanyAccess` inline `<svg>` → `<Icon name="lock" size={20} />` | `master/company-filter.tsx` |
| 6c | D16 unused CSS | Grep each selector before deleting it. **Delete:** `.gsearch*`, `.ctx*` and `.ctxsel` (with the unused `ctx` variant in `ui/select.tsx`), `.cmd*`, `.ci2*`, `.cme`, `.tb-reset*`, `.wipe*`, `.rolock` (keep the shared `.ro .rate`), `.rnav*`, `tr.fr` / `.fin*` / `.flbl`, `.leaf .n`, the `.grp-b` chevron and open states, `.back`, plus `kbd` / `.kbrow` if unused. **Keep:** `.tb-burger`, `.scrim`, `body.nav-open` (used from WP5) and the print block with `.psheet` / `.ps-*` (§13.2, O-P) | `app/globals.css`, `components/ui/select.tsx` |
| 6d | Stale comments | Remove the "chosen from the topbar" and "topbar company selector" wording | `master/account-tree.tsx`, `ui/select.tsx` |

**Guards:**
- No `style={{ background: "var(--` anywhere under `components/`.
- No `<svg` outside `components/icon.tsx`.
- The deleted selectors do not reappear in `globals.css`.

**Verify:**
- In the browser: the dashboard, a register's KPI row, the Fiscal Year periods,
  the Cash & Bank detail and the access-denied page look the same as before.
- The existing test "no component styles itself with a rule that does not
  exist" still passes, which proves nothing deleted was in use.

---

### WP7 — Documentation close-out
- Apply the remaining CLAUDE.md touchpoints (§2) not already done by their work
  packages.
- In `Good Concept/design-convention.md`, Appendix A: mark the reference as
  conforming to D1–D20, and remove the pointer to this plan.
- Delete this plan file, or mark it *Executed* with the commit list.

---

## 4. Verification protocol (every work package)

1. `npm run build` (typechecks), `npm run lint`, `npm test`. All green.
2. In the browser, check the screens listed in the package's **Verify** list,
   with screenshots of the before and after where layout changes.
3. Report what was verified and what was not, per CLAUDE.md §15.

---

## 5. Not in this plan

- **D21 (hard delete):** SIBA has no delete, and that stays so.
- **D22 (no drawers, tabs, custom tooltips, skeletons, column chooser):** SIBA
  already conforms.
- **Print sheet and export (O-P), charts (O-C), bulk actions (O-B):** still open
  in the convention. Nothing is built for them.

---

## 6. Questions to settle before execution

| # | Question | Default if you don't say otherwise |
|---|---|---|
| Q1 | The Budget Month list grows by 12 rows per fiscal year. Under D11 it grows with use, so it gets a pager. Or should it be exempt as "bounded by structure"? | Page it |
| Q2 | The Role list is user-created but usually tiny. Should it get a pager anyway, since D11 has no size threshold? | Page it |
| Q3 | D15: rewritten footnotes are user-facing copy. Should I show you the new sentences before committing WP2? | Yes, show first |
| Q4 | Execution: all work packages in one go, or one work package per go-ahead? | One work package per go-ahead |
