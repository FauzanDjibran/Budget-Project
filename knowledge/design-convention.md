# Design Convention

> **A shared UI/UX convention for all my business applications.** New projects
> follow this document so they look and behave the same.
>
> **Where it comes from.** It was extracted from a working application, the
> *reference implementation* (SIBA 3.0, `D:\Claude Code\Budget-Project`, commit
> `46ce4a1`, read 24 September 2026). The rules below are stated generically.
> File paths to the reference appear only in §14 and in the appendices.
>
> **Companion.** `Core_UI_Reference.md` (same folder) is the benchmark study the
> reference implementation was designed against. Appendix B records what was
> adopted from it and what was rejected.
>
> **Placeholders.**
>
> | Placeholder | Stands for |
> |---|---|
> | `<Entitas>` | a master-data entity (e.g. Partner, Currency) |
> | `<Dokumen>` | a transactional document with a lifecycle |
> | `<apa>` | the thing being chosen or searched |
> | `<Aksi>` | a lifecycle action |
>
> UI copy is Indonesian (§10.17). Code identifiers are English.

---

## 1. Purpose & Governance

### 1.1 Purpose
- One vocabulary of layouts, controls, interactions and states for every
  project.
- A user who learns one application can use the next without relearning it.
- A developer can build a screen without inventing a pattern.

### 1.2 Scope
**In scope:**
- application shell and navigation
- page types: list, form, detail, report, tree, dashboard, state pages
- tables and forms
- dialogs and popovers
- shared components
- interaction states
- responsive behaviour

**Out of scope:** business rules, data models and backend conventions, except
where they change what the UI shows. Permission-driven visibility and
server-side validation feedback are the two in-scope examples.

### 1.3 Source-of-truth principle
- **Evidence.** Every convention here is backed by the reference implementation
  and was extracted, not designed.
- **Classification.** Each rule is marked:
  - **Established**: implemented consistently in several places. Follow it.
  - **Variation**: differs by context on purpose. Both forms are valid where
    stated.
  - **Decided (Dn)**: the reference implemented it more than one way, and a
    decision (24 September 2026) chose one. **It is the rule**, even where the
    reference has not yet been brought in line. The decision log is §13.1.
  - **Open**: not implemented, or not yet decided. Listed in §13.2 and **not** a
    rule until a decision is recorded here.
- **Visual source.** The design system is **one global stylesheet of tokens and
  class names**, carried from project to project (§10.1). Components emit its
  class names and never restyle them.
- **Precedence.** If a project's code and this document disagree, the project
  has drifted. Fix the code, or change this document through a recorded
  decision. Never let the project diverge silently.

### 1.4 How new UI should use this document
1. Identify the page type (§4). Copy the structure of its reference
   implementation (§14).
2. Build every control from the shared components (§10). **One repeated control
   = one component.** Never reproduce one by hand.
3. Express states with the existing classes (§11).
4. For anything this document does not cover:
   - listed in §13.2 → decide it and record the decision here first;
   - genuinely new → add one component and one section here, in the same
     change.
5. **Enforce the rules mechanically** (the reference does it this way). Keep a
   source-scan test in each project that fails on convention breaches, for
   example:
   - a native `<select>`, date input or number input;
   - a hand-built search box, dialog or form field;
   - a date or number formatted outside the one formatting module;
   - a header whose destructive button sits right of its primary button.

   Reference: `tests/design-system.test.ts`.

---

## 2. Design Principles

Every principle below is demonstrated by the reference implementation.

| # | Principle | Rule |
|---|---|---|
| P1 | **Actions live in one place.** | Every page action sits in the **sticky page header's action slot**, top right. There are no bottom action bars. |
| P2 | **Buttons do not move under the cursor.** | Header buttons run **danger → neutral → primary**, with one primary at the far right. Vertical menus reverse this: safe first, danger last. |
| P3 | **The app draws its own controls.** | No native `<select>`, date input or number input. Every picker, date field and amount field comes from the application. |
| P4 | **Read-only is text, not a disabled input.** | See §8.5. |
| P5 | **A record's heading is its identity.** | A document shows its number and status. A master record shows its name and code. A heading is never a description. |
| P6 | **"Not yet" waits; "not applicable" hides.** | A field whose prerequisite is unanswered stays visible and inert, naming what to fill first. A field that can never apply to this record is hidden. |
| P7 | **Show only what the user can use.** | Menu entries, create buttons, row actions and empty-state CTAs all follow permissions. The server re-checks everything. The UI is never the protection. |
| P8 | **Consequences before commitment.** | Every state change goes through a confirmation that states what will happen. |
| P9 | **Dense, mouse-first forms.** | A 12-column row. Help text on the label line. Control height fixed at 34px and never reduced to save space. |
| P10 | **State a fact once.** | No summary side cards. No criteria restated below a filter. A balanced total is never labelled; only a problem speaks. |
| P11 | **Distinguish kinds of nothing.** | "No data yet", "nothing matches", "no access", "not run yet" and "a real zero" are five different states (§11). |
| P12 | **Locale formats in one module.** | Dates `dd/mm/yyyy`. `.` groups thousands, `,` separates decimals. Every date and number goes through one formatting module. |

---

## 3. Application Shell & Navigation

### 3.1 Shell layout — *Established*
**Purpose.** A fixed frame so that only the page content scrolls.

**Convention.**
- Four regions, left to right:
  1. **Topbar**, 52px, across the top.
  2. **Icon rail**, 58px wide, dark.
  3. **Submenu panel**, 238px wide, a white card.
  4. **Content area**.
- The app container fills the viewport and does not scroll. Only the content
  area scrolls.
- Gaps and padding are 12px.

**Structure.**
```
.topbar   brand ─────────── spacer ─────────── user chip ▾
.rail     one icon per module
.sub      module name + description · collapse ‹ · groups → leaves
.content  page (sticky header, then body)
```

### 3.2 Topbar — *Established*
**Purpose.** Show which app this is and give access to the user's account.
Nothing else goes here.

**Convention.**
- **Left: brand block.** A small mark tile, the app name and a mono version
  chip. It is not a link.
- **Right: user chip.** Avatar initials, the user's name and a `down` icon. It
  opens an account menu containing:
  - a header with name, email and role badges; a user with no role shows
    "Tanpa Role";
  - `Profil Saya`;
  - `Keluar`, last, danger-coloured, separated by a border.
- The menu closes on a mousedown outside it.

**Don't.**
- Don't put a scope selector (company, branch, unit) in the topbar. Scope is
  chosen on the pages that need it (§5.4). A global context makes every page
  depend on a control elsewhere.
- Don't add global search or a command palette. Neither is part of the
  convention, and their unused styles are to be removed (D16).

### 3.3 Sidebar: icon rail — *Established*
**Purpose.** Switch between modules.

**Convention.**
- One 44×44 icon link per module.
- **Active module:** accent background, brand-coloured icon, soft glow.
- **Label:** none visible. The module name appears as a dark hover tooltip with
  an arrow.
- **Click target:** the module's **first visible leaf**. A module with no leaves
  opens its single page (e.g. the dashboard).
- **Clicking a module always opens its submenu. It never toggles it.** This is
  the only way to bring back a collapsed submenu.

**Don't.**
- Don't make a rail click collapse the submenu.
- Don't link the rail to an empty module landing page.

### 3.4 Sidebar: submenu panel — *Established*
**Purpose.** Move around inside the current module.

**Convention.**
- **Header:** module name and a one-line description, with a round collapse
  button (`back` icon, "Sembunyikan menu").
- **Hierarchy:** Module → Group → Leaf. **Two levels inside the panel, never
  deeper.**
- **Groups** are permanent headings with an accent dot. They cannot be
  collapsed.
- **Leaves** are links. The active leaf has a light fill, brand text and bold
  weight. Long names truncate with an ellipsis.
- **Active leaf rule:** the leaf whose slug is the **longest prefix** of the
  current path. Detail, edit and nested pages therefore keep their list leaf
  highlighted.
- **Collapse:** the panel animates to width 0. The state lasts the session and
  is not stored.
- **Permissions:**
  - a leaf the user cannot open is removed;
  - a group left empty is removed;
  - a module left empty leaves the rail.
- **Landing after login:** the first visible leaf. A user with nothing visible
  lands on their profile.

**Do.**
- Declare navigation as data: module → group → leaf. Each entry has a slug,
  icon, description and permission.
- Ship a working route in the same change as any new menu entry. **A menu
  destination always renders.** If a feature is not built yet, the route
  explains that; it never shows a bare 404.

**Don't.**
- Don't nest a third level in the panel.
- Don't show counts on leaves (not established).

### 3.5 Menu grouping — *Established*
- Groups sort a module by the **kind of work**:

  | Kind | Example group names |
  |---|---|
  | Master entities | Entitas, Referensi |
  | Execution documents | Eksekusi |
  | Adjustments | Penyesuaian |
  | Reports | Laporan |
  | Period or system control | Period Control, Sistem |

- **Reports are ordinary leaves, always in a group named *Laporan*** inside
  their module (*Decided, D6*). Never put a report next to the register it
  reports on. The report breadcrumb (`MODUL / LAPORAN / NAMA`) depends on this.
- Every module, group and leaf carries a one-line description. The module
  description appears in the submenu header. A leaf description becomes its
  list page's subtitle.

### 3.6 Page header, title & breadcrumb — *Established*
**Purpose.** From anywhere on the page, show where the user is, what this is,
and what can be done.

**Convention.** The page header is the first element of every page. It is
**sticky** at the top of the content area: z-index 30, background matching the
page, a soft bottom shadow.

**Structure.**
```
.crumb   MODUL / ENTITAS / CURRENT        9.5px uppercase, muted; current in brand colour
.ph-row  h1 [icon tile] Title [chips/badges]           .ph-act [actions →]
.ph-sub  description                      list pages & dashboard only
.rfil    report filter                    report pages only
```

**Breadcrumb links** (*Decided, D5*):

| Segment | Rendering |
|---|---|
| Module | **plain text**. A module has no page of its own, since the rail opens its first leaf |
| `LAPORAN` (reports) | plain text |
| Entity (on form and detail pages) | a **link back to the list** |
| Current | `.cur`, brand colour, not a link |

**Do.**
- Start the `h1` with the entity or report icon in a 30px tile. Title size is
  19px, weight 800, brand colour.

**Don't.**
- Don't add a subtitle to a form page or a report page.
- Don't add a back button to the header. The breadcrumb is the way back.
- Don't write a CSS rule for the header class unscoped. The reference scopes it
  `.pad > .ph`, because `.ph` is also the placeholder class inside pickers.

### 3.7 Navigation between pages — *Established*
| URL shape | Page |
|---|---|
| `/<module>/<slug>` | list |
| `/<module>/<slug>/new` | create |
| `/<module>/<slug>/<id>` | view |
| `/<module>/<slug>/<id>/edit` | edit |
| `/<module>/report/<slug>?<params>` | report |

- **A row click opens the detail page**, in every list and tree.
- **Drill-through:** a link inside a table cell opens a narrower view (§7.7).
- All navigation uses real links and router pushes, never hash routing. Anchors
  are reset to look like the shared button, crumb and leaf classes.

---

## 4. Page & View Conventions

### 4.1 LIST page — *Established*
**Purpose.** Find a record, open it, or start a new one.

**Usage.** Every master entity. Every document register.

**Structure.**
```
.ph        crumb · h1 [icon] <Entitas> · .ph-act [secondary…] [+ Tambah <Entitas>] · .ph-sub
.kpis      (registers, optional) clickable KPI tiles
.card      toolbar → table → pager
.foot-note (optional) one sentence: how to read the list (D15)
```

**Interaction.**
- A KPI tile is a button. It either **sets the list's filter** (e.g. "Belum
  Diposting" filters to Draft) or **opens a breakdown dialog**.
- A tile that opens something shows "Rincian ›".

**Do.**
- Show the create button only when the user has the create permission.
- Label it `Tambah <Entitas>`. A document register may use `Buat Dokumen`.
- Put secondary buttons (e.g. a report) to the left of the create button, in
  neutral style.

**Don't.**
- Don't show a create button for an entity that cannot be created. Show a muted
  `Terkunci` badge with a lock icon instead.

### 4.2 FORM page: create & edit — *Established*
**Purpose.** Enter or change one record.

**Convention.**
- **One component serves new, view and edit**; the route chooses the mode.
- The body is a single-column form grid of cards (§8).
- A saved record always ends with its **history card** (§10.15).

**Structure.**
```
.ph   crumb Modul / Entitas / Baru|<identity>
      h1 [icon] <identity> [status] [Mode Ubah]     .ph-act [● Belum disimpan] [Batal] [💾 Simpan]
(error card: whole-form refusal)
card(s): [.card-h] FormBody › FormSection › FormRow › Field …  [closing note]
history card                                         (view & edit; never on new)
```

**Heading rules:**

| Record | New | Saved |
|---|---|---|
| Master record | `<Entitas> Baru` | name + label chip + mono code chip |
| Document | `<Dokumen> Baru` | mono document number + status badge |

**Edit mode** adds a **"Mode Ubah" tag in amber (`t-warn`) on every form**
(*Decided, D3*). It sits with the amber "Belum disimpan" chip: both are about
editing. The tag is tinted, not solid, so it never reads as a status.

**Container:** always **single column** (`.fgrid.solo`) (*Decided, D12*). A
two-column form grid is not used, because there is no side card to fill it.

**Don't.**
- Don't add a summary side card, a page subtitle or a bottom button bar.
- Don't title a document with its description.

### 4.3 Detail / view page — *Established*
**Purpose.** Read a record and move it through its lifecycle.

**Convention.**
- It is the form component in view mode. Every value renders as read-only text
  (§8.5).
- Related content sits in cards below the form: children, a linked summary,
  document lines.
- The history card is always last.
- **A document shows its own figures only.** A related document (its order, its
  bill, its tax document) is a **link** in a *Referensi* card, never its
  figures embedded. *Why:* a figure shown twice is a figure that can disagree.
- **Detail-only pages** have no edit mode. Use them for records that are only
  ever read or answered, e.g. a system-produced journal, an incoming request.

**Header actions by state** (danger → neutral → primary; §10.2):

| Record state | `.ph-act` reads |
|---|---|
| Master record, active | `Nonaktifkan` (danger) · `Ubah` (primary) (D14) |
| Master record, inactive | `Aktifkan` (neutral) · `Ubah` (primary) (D14) |
| Master record with more actions (e.g. a user) | `Nonaktifkan` · `Reset Password` · `Ubah` |
| Draft document | `Batalkan · Ubah · <Ajukan \| Post>` |
| Returned / rejected document | `Batalkan · Ubah · Ajukan` |
| Awaiting approval | `Tolak · Batalkan · Setujui` |
| Master record with its own lifecycle (e.g. activate a period) | `Ubah · <Aktifkan …>` |
| Final (posted / cancelled / closed) | no buttons; a lock chip says why ("Terkunci setelah Post", "Dokumen dibatalkan", "Menunggu …") |

**Status change is a header button** (*Decided, D14*). The status badge in the
heading is **display only**.
- `Nonaktifkan` is danger-toned, so it sits leftmost.
- `Aktifkan` is neutral.
- Both open the status confirmation (§9.1).

**Do.**
- When a lifecycle action is the page's primary, show `Ubah` in neutral style,
  to that action's left.
- Derive each button's label, icon, tone and permission from **one transition
  table per document type**. The header, the row menu and the server all read
  the same table.

### 4.4 REPORT page — *Established*
A screen whose whole job is to show a report:
- the filter sits inside the sticky header;
- `Tampilkan` is the header's primary button;
- the body is one card, followed by a one-sentence footnote and a run
  timestamp;
- it never writes.

Full convention in §7.

### 4.5 TREE page — *Established*
A list page whose body is a hierarchy instead of a table. Use it when the shape
of the data is the information. Full convention in §6.

### 4.6 Dashboard — *Established*
**Structure.**
```
.ph        crumb · h1 · .ph-sub
.kpis      headline tiles
.two       two-column card grid (auto-fit, min 340px)
.card      .card-h + attention rows / table / .empty.sm
.foot-note
```

**Convention.**
- An **attention row** has a tinted icon, a bold title and one line of
  explanation. It is a link when it leads to the fix.
- Each card has its own small empty state.
- **Content is MECE:** no figure appears twice, and draft records are not
  business figures and are left off.

### 4.7 Locked page — *Established*
**Convention.**
- A route the user may reach but whose write path is closed still renders. It
  never 404s.
- It shows the normal header with a muted `Terkunci` badge, then one card with
  an empty state explaining why, and a `Kembali` button.
- No form is rendered.

### 4.8 Error, forbidden & login pages — *Established*
- **Forbidden inside the shell:** the page header (lock icon, "Akses ditolak")
  and a card with an empty state and `Kembali`. Navigation stays usable, and the
  user stays signed in.
- **Unexpected error:** the same component, titled "Terjadi kesalahan". **It
  never reveals the cause.**
- **Outside the shell** (login, forbidden before the shell loads): one centred
  card (max 392px, radius 18) on a soft gradient, with the brand block on top.
  The primary button is full width.

---

## 5. List & Table Conventions

### 5.1 Data table — *Established*
**Purpose.** Scan records and open one.

**Structure.** A horizontal-scroll wrapper around a full-width table.

| Part | Convention |
|---|---|
| Header | **sticky** · 10px · uppercase · letter-spaced · muted · white background |
| Row | 38px high · hover tint · pointer cursor · **the whole row opens the detail page** |
| First column | `No`, 38px, muted tabular digits, numbered across pages |
| Last column | row actions, 88px, no header label |
| Widths | fixed pixel widths on every column except one flexible descriptive column |

**Cell formats:**

| Content | Rendering |
|---|---|
| Main name | bold, ink colour |
| Secondary | muted |
| Number | right-aligned, tabular digits |
| Money | mono. Incoming is green. A signed register prefixes `+ ` / `− ` and gives the direction as a tooltip |
| Master reference | code chip (mono, brand-tinted) + name, on **one line** |
| Document number | code chip, as a link |
| Two-line descriptor | bold first line with ellipsis, 10px mono muted second line |
| Status | solid badge (§10.3) |
| Date | `dd/mm/yyyy`. A document without a date yet shows a muted phrase, e.g. "belum diposting" |
| Empty value | muted "—" |
| Long text | ellipsis at 280px |

**Don't.**
- Don't show raw enum or code values where the user expects words.
- Don't format outside the formatting module.

### 5.2 Row actions — *Established* (third slot: *Variation, D18*; alignment: *Decided, D19*)
**Convention.**
- Icon buttons, 24px, right-aligned, muted until hovered, in this order:
  1. `eye` "Lihat detail": always shown.
  2. `pen` "Ubah": only with the permission **and** when the record's status
     allows editing.
  3. The third slot depends on the record:
     - **Master record:** a status toggle, `gear` icon ("Nonaktifkan" /
       "Aktifkan"). It opens the confirmation directly.
     - **Document with lifecycle:** "Aksi lain", with the **`more` (⋯) icon**.
       It is dimmed until the row is hovered, and opens the row menu (§9.5).
       `hist` means history only.
- **Every slot is always reserved** (*D19*). An action that does not apply
  leaves an empty 24px space, so the icons stay in fixed columns down the
  table.
- Every row action stops the click from also opening the row.

**Don't.**
- Don't run a state change straight from a row. Always go through the
  confirmation dialog.

### 5.3 Bulk actions & selection — *Established absence*
- Lists have no row checkboxes, no select-all and no bulk bar.
- Multi-selection exists **only inside picker dialogs** (§9.2). There, a
  selected row is accent-tinted and an unavailable row is faded.

### 5.4 Toolbar, search & filters — *Established*
**Structure.**
```
toolbar  [Scope ▾]  [🔍 Cari <apa>…  ×]  [Filter ▾]…  [Bersihkan filter (n)]  ── spacer ──  N dari M data
```

**Convention.**
- **Search:**
  - one search component: icon, `Cari <apa>…` placeholder, and a clear `×` once
    there is text;
  - it searches client-side across all displayed column text;
  - each keystroke resets to page 1;
  - it takes the full width when it is the only control.
- **Scope filter** (for data owned by one of several companies, branches or
  units):
  - it comes first in the toolbar, is stored in the URL (`?scope=`) and makes
    the server re-query;
  - **it is hidden when the user can see fewer than two scopes**, because a
    single option is not a choice;
  - if the user can see no scope at all, a "no access" empty state replaces the
    whole card.
- **Attribute filters** are dropdowns in the toolbar, in the **toolbar** trigger
  style. An active filter shows its trigger with an accent tint.
- **The "all" option reads `<Filter>: semua`**, e.g. "Status: semua",
  "Arah: semua" (*Decided, D2*). With several filters side by side, each one
  names itself. The compact trigger style is for the pager only.
- **Clear:** a ghost button "Bersihkan filter (n)" appears once anything is
  active. The search counts as one.
- **Count:** "**N** dari M data" (or "dokumen").

**Don't.**
- Don't add per-column header filters. They are not part of the convention, and
  their unused styles are to be removed (D16).
- Don't add a separate filter panel that duplicates the toolbar.

### 5.5 Sorting — *Variation*
- **Generic master lists:** every column is sortable. A click cycles ascending →
  descending → unsorted. The active column shows ▲ or ▼ in brand colour; the
  others show a faint ▲.
- **Document registers:** not sortable. The server order (newest first) stands.

### 5.6 Pagination — *Established* (page-number style: *Decided, D1*; coverage: *Decided, D11*)
- Client-side, below the table:
  - "Halaman **x** dari **y** (n total)" on the left;
  - a compact page-size dropdown, "Tampil 10 / 25 / 50 / 100", **default 25**;
  - `« ‹ [x] › »` on the right.
- **Only the current page number is shown, highlighted with the accent fill**
  (*D1*). The pager then keeps a fixed width, so `›` and `»` never move as
  pages are added.
- Changing the page size, the search or a filter resets to page 1.
- **Which lists paginate** (*D11*): **every list whose row count grows with
  use.** Only a list bounded by structure is exempt, i.e. one whose rows are
  fixed by the data model rather than by use (e.g. the months inside one year).
  Build the pager as **one shared component**.

### 5.7 Column visibility — *Established absence*
- No column chooser.
- Columns are fixed per entity.

### 5.8 List empty states — *Established*

| Case | Icon | Heading · body | CTA |
|---|---|---|---|
| No records yet | entity icon | "Belum ada <Entitas>" · "Data akan muncul di sini setelah … pertama dibuat." | primary create button, **only with permission** |
| Nothing matches | search | "Tidak ada data yang cocok" · "Ubah kata kunci atau bersihkan filter…" | "Bersihkan filter" |
| No scope access | lock | "Tidak ada akses …" · who to ask | none |

The table header stays visible above an empty state.

---

## 6. Tree / Hierarchical List Conventions

### 6.1 Tree list — *Established*
**Purpose.** Show hierarchical master data whose shape is the point.

**Usage.**
- Use it when a flat table would hide the parent/child structure (e.g. a chart
  of accounts, a category hierarchy).
- **Only the list becomes a tree.** Detail, create and edit stay the generic
  form, where the parent is a field.

**Structure.** A tree uses the **list page shell**, not a dedicated layout.
```
.ph    h1 · .ph-act [+ Tambah <Entitas>] · .ph-sub
.card  toolbar [Scope ▾] [🔍 Cari kode, nama … (full width)]  N <entitas>  [Buka Semua] [Tutup Semua]
       .card-h  structure title [scope chip] · one-line explanation · hint "Klik baris … untuk membuka detail"
       tree
```

**Two kinds of node:**

| Kind | Look | Click on the row |
|---|---|---|
| **Structure nodes** (seeded headings, groupings) | tinted bands; the top level darker and bolder; show a count | expand / collapse |
| **Data nodes** (records, any depth) | code chip + name + indicators | **open the detail page** |

**Interaction.**
- **Indentation:** each level's children sit in a container indented 19px + 11px
  with a 1px guide line on the left.
- **Expand / collapse:** a chevron rotates 90° when open. A data node with
  children has a chevron button. A leaf has a small dot instead.
- **Default:** everything starts **open**. Store the closed branches, so a new
  branch arrives open.
- **Buka Semua / Tutup Semua** are a **pair of small buttons in the card's
  toolbar**, after the count (*Decided, D7*). They are view controls, not page
  actions, so they stay out of `.ph-act`.
- **Search:**
  - matches code or name;
  - keeps every ancestor of a match;
  - **forces every branch open while searching**;
  - hides structure nodes with no match;
  - updates the count.
- **Row actions:** view and edit icons, **shown on hover only**. There is no
  status toggle in the tree; status is changed on the detail page.
- **Create:** only from the header. There is no "add child here" on a node.
- **Selection and pagination:** none. The whole hierarchy for the chosen scope
  renders.

**Node indicators** (right-aligned):
- child count ("N turunan");
- tag badges;
- one-letter flags in 20px tiles, each with a tooltip (e.g. H = header, C =
  control);
- labelled chips for categorical attributes;
- **inactive record:** italic, muted name plus a solid "Non Aktif" badge.

**Empty states.**
- A structure node with no children: an inline faint line, "Belum ada … pada
  kelompok ini."
- A search with no match: an empty state with "Bersihkan pencarian".

**Do.** Show one scope's hierarchy at a time. Mixing scopes reads as duplicated
nodes.

**Don't.** Don't keep row actions permanently visible in a tree.

### 6.2 Collapsible rows and blocks elsewhere — *Established* (control: *Decided, D7*)
The same vocabulary appears in reports: a chevron that rotates 90°, plus
Buka / Tutup Semua.

**Expand-all rule** (*D7*), for trees and reports alike:
- **always a pair**: `Buka Semua` (`expand` icon) and `Tutup Semua` (`collapse`
  icon), both small buttons;
- **never one toggle** whose label flips under the cursor;
- **placed in the bar directly above the content it controls**: the card
  toolbar for a tree, the result bar for a report;
- **never in the page header's action slot.**

- **Hierarchical statement table:**
  - The first column indents one class per depth level (14px each).
  - Row types: step, category, subcategory, detail, result.
  - **A heading shows its total only while folded.** When open, its rows show
    the figures.
  - Detail breakdowns start folded. Result lines never fold.
- **Collapsible subject blocks:** one block per subject, **rolled up by
  default**. The block header states the totals.

---

## 7. Report Conventions

### 7.1 Report menu — *Established*
- A report is an ordinary menu leaf. Its slug is `report/<slug>`.
- Every report is declared **once, in a catalogue in code**: slug, module, name,
  icon, permission and parameter set. One dynamic route per module resolves the
  entry and checks that report's permission.
- Adding a report means adding a catalogue entry, a permission, a menu leaf and
  a body component. Never a new route file.
- Permission names follow `REPORT_<SUBJECT>_VIEW`.

### 7.2 Report View layout — *Established*
**Structure.**
```
.ph (sticky)  crumb MODUL / LAPORAN / NAMA
              h1 [icon] Nama [tag "Laporan"]                      .ph-act [🔍 Tampilkan]
              .rfil  row  Scope · subject
                     row  Periode [dd/mm/yyyy] s/d [dd/mm/yyyy]
                     row  chips / comparison
.card         [statement title] · result bar · subject blocks / table
.foot-note    one sentence
.rstamp       "Dibuat <timestamp>"   (omitted when the statement title states it)
```

**Don't.**
- Don't add a page subtitle.
- Don't restate the criteria under the filter; the sticky filter already shows
  them.
- Don't put the filter in a toolbar inside the card.

### 7.3 Filters & parameters — *Established*
**Convention.**
- **Parameters live in the URL**, so a run can be linked, bookmarked and
  navigated with Back.
- The page reads the database directly on the server.
- **Rows follow the order the filter is filled in:** first *what* (scope, then
  subject), then *when*, then *what to compare against*.
- The first label of each row is 78px wide, so the rows line up.
- Labels are 9px, uppercase.
- Filter controls are compact: **30px** high instead of the form's 34px. Pickers
  are 168–230px wide; dates are 112px.

**Parameter sets:**

| Parameter set | Controls |
|---|---|
| Subject + period | scope · one subject picker · period `from` s/d `to` |
| Subject, no period | scope · subject. Used for a standing position, where a date range would do nothing |
| Several subjects + period | scope · subject picker that adds **chips** on their own row (click a chip to remove it; a text link clears all) · period |
| Fiscal period | scope · year · period · mode `Periode ini` / `s.d. Periode ini` · `Bandingkan`, which reveals a second year and period in the same mode |

### 7.4 Generate & apply — *Established*
**Convention.**
- **`Tampilkan` is the header primary**, in the same place as a form's `Simpan`.
  It renders only after the filter has registered what "run" means.
- **Blocked:** the button is disabled and its tooltip names the reason, e.g.
  "Pilih <apa> terlebih dahulu." It is also disabled while the run is loading.
- **The scope picker applies immediately**, because every other picker's options
  depend on it. **Every other field applies only on `Tampilkan`.**
- An invalid date range marks both date fields invalid and shows an inline error
  in the row.
- **Refresh:** there is no refresh button and no auto-refresh. Running it again
  re-reads the data.
- Defaults (e.g. the latest period) are set by the route, not the filter.

### 7.5 Result presentation — *Established*

| Element | Convention |
|---|---|
| Result bar | Above the blocks: count, period, expand control. It is not a toolbar |
| Subject block | A bordered block. Its **dark navy header** shows the code, then name and meta, then a summary strip on the right |
| Summary strip | Label above value, mono, right-aligned. **The closing figure comes last and larger.** A zero is dimmed; a negative is pink |
| Opening / closing rows | The opening balance is the first body row ("Saldo awal per …"). The closing balance is in the footer ("Saldo akhir per …") |
| Secondary info | Folded into a cell as a 10px mono sub-line, or a one-letter tile, **instead of a column of its own** |
| Statement title | For formal statements: two compact lines (report name · scope · type; then each column's dates · run time) |
| Comparison columns | `Pembanding · Selisih · Selisih %`. The percentage is blank when the base is zero |

- **Width:** no horizontal scroll. Money columns have fixed widths and one text
  column flexes.
- **Charts:** none yet. The convention is open until a report needs one
  (§13.2).

### 7.6 Balance & reconciliation — *Established*
- A money report reconciles on its own page: `awal + masuk − keluar = akhir`.
  That is why a ledger has **no entry-type filter**.
- **The balanced case is never labelled.** An imbalance gets a red pill in the
  block header plus one sentence.
- A reconciliation failure shows a warning box under the block, and the report
  is still displayed "apa adanya".

### 7.7 Drill-through — *Established*
- A summary row links to the detail view for **the same parameters** (scope and
  range carried over): summary → ledger → source document.
- A computed line has no drill-through.

### 7.8 Empty results — *Established*

| Case | Rendering |
|---|---|
| No subject chosen yet | small empty state: the report **has not run** |
| No movement in the period | **not an empty state.** The opening and closing rows still render, with a muted in-table row saying there was no movement |
| Subject not found or out of scope | small empty state explaining it |

**Every empty state inside a report body uses the small size** (*Decided,
D8*). The page-level size is for a card that is the whole page.

### 7.9 Export & print — *Reserved*
- Export and print buttons go in the header action slot, **to the left of
  `Tampilkan`**.
- A print stylesheet hides the shell, toolbars, pager, header actions and row
  actions, and un-sticks the header.
- A print sheet layout is not yet established (§13.2).

### 7.10 Read-only — *Established*
- A report never writes.
- No report row carries an action that changes data.

---

## 8. Form Conventions

### 8.1 Layout — *Established*
**Convention.**
- Every form is built from four primitives: `FormBody` › `FormSection` ›
  `FormRow` › `Field`. **Nothing else renders a labelled field.**
- **Row:** a 12-column grid with 18px column gaps. A field spans 3, 4, 5, 6, 8
  or 12 columns.
  - Default: half the row.
  - Generic master forms: a third per field.
  - Long text: the full row.
- **Container:** always a single column (*D12*). There is no side card.
- **Sections:**
  - Master form: business fields; then **Status Data**; then the note.
  - Document: one card per part (e.g. header, lines). Each card opens with a
    card header: icon tile, title and a one-line purpose.
  - A section title (9.5px uppercase) is used only when a card holds more than
    one section.
- **Not used:** tabs, accordions, wizards.

**Don't.**
- Don't hand-write field markup.
- Don't shrink the 34px control to save space. Only the padding around it may
  shrink.

### 8.2 Field anatomy — *Established*
```
LABEL *  [TERKUNCI]                          help clause (right-aligned, one line, ellipsis + tooltip)
control (34px)
⚠ error message                              (only when invalid — replaces the help)
```

| Part | Convention |
|---|---|
| Label | 9.5px, weight 800, uppercase, muted |
| Required | red `*`, in new and edit mode only |
| Locked | "Terkunci" chip, for a field that cannot change after the record is created |
| Help | **one lower-case clause, no full stop, on the label row**, shown only while editing. **Never under the control** |
| Error | a red line under the control with a warning icon. The control gets a red border and halo |

### 8.3 Controls — *Established*
Each kind of input has exactly one component; details in §10.

| Need | Control |
|---|---|
| Short text | text input (mono variant for identifiers) |
| Long text | textarea, 2 rows, resizes vertically |
| Reference to a record | searchable reference picker (§10.8) |
| Choice from a list | dropdown (§10.8) |
| Set of references | multi-select: a picker that adds, and chips that remove. **Never a checkbox grid** |
| Date | date field (§10.9) |
| Amount | money field (§10.10) |
| Rate / ratio | the money field with more decimals and a pair label |
| Boolean | checkbox card (a one-line variant for a caption that stands alone) |
| Composed code | a read-only inherited prefix plus one typed segment. The segment waits ("menunggu induk") until its parent is chosen |
| Choice with several attributes per option | a panel dialog with a table of options (§9.2). The field then shows the single attribute that matters |

**Picker prompts:**
- `Pilih <apa>…`
- `Tambah <apa>…` once a multi-select already has items
- `— tidak diisi —` for the empty option of an optional dropdown

### 8.4 Dependent fields — *Established*
- **Waiting (prerequisite unanswered):**
  - The field stays visible and inert, styled `.wait`.
  - Its prompt is italic: `Pilih <first missing field> dulu…`.
- **Not applicable to this record:** the field is **hidden**.
- **Reset:** changing a field clears the fields that depend on it. Declare each
  dependency **once** (`resets`). The waiting logic reads the same declaration.
- **Ordering:** a prerequisite always comes before the field it gates.
- **Visual difference:** `.dis` means "never editable" and `.wait` means "not
  yet". The two look different on purpose.

**Don't.**
- Don't open a picker onto "Tidak ada pilihan yang cocok" when the real cause
  is an unanswered prerequisite.
- Don't hide a field that is only waiting.

### 8.5 Read-only presentation — *Established* (locked fields: *Decided, D13*)

A value that cannot be edited is **always text, never a disabled control**. This
covers view mode **and** a field that is locked in edit mode. A locked field in
edit mode renders exactly as below, with the "Terkunci" chip on its label.

| Value | Shown as |
|---|---|
| Plain value | text on a 26px line with a dashed underline |
| Empty | "tidak diisi", italic and faint |
| Reference | code chip + name |
| Set | tinted chips |
| Boolean | badge "Ya" / "Tidak", or "Aktif" / "Non Aktif" for a status |
| Choice | badge showing the option's **label**, never the stored value |
| Money | mono, with its currency |
| Long text | pre-wrapped text |

### 8.6 Create vs edit — *Established*

| | New | Edit |
|---|---|---|
| Heading | `<Entitas> Baru` | identity + "Mode Ubah" badge |
| Prefill | system default → field default → **today** for editable dates | stored values |
| Create-only fields | shown | hidden |
| System-derived fields | hidden | hidden (shown read-only in view mode) |
| Locked fields | editable | read-only text + "Terkunci" chip (D13) |
| History card | none | at the foot of the page |

A system default **only prefills** a new record. It never changes an existing
record and never restricts what is valid.

### 8.7 Save & cancel — *Established*
**Unsaved-changes chip.** After the first change, a pulsing warning chip
"● Belum disimpan" appears beside the buttons.

**Simpan** is the primary, with a `save` icon. It shows "Menyimpan…" and is
disabled while saving.

| Outcome | What the user sees |
|---|---|
| Success | success toast ("<Entitas> dibuat — Kode sistem … dibuat otomatis.", or "Perubahan tersimpan …"); then navigation to the view page and a refresh |
| Field errors | each error inline under its field, plus an error toast "Belum bisa disimpan — N field perlu diperbaiki." |
| Whole-form refusal | an error toast "Tidak diizinkan"; document forms also show an error card above the form |

**Batal** is a neutral button with the `back` icon (*Decided, D4*). It returns
to the view page (edit) or the list (new).

**Discarding unsaved changes** (*Decided, D20*):
- When the form is dirty, `Batal` opens a confirmation before leaving:
  - `warn` icon, danger tone;
  - title `Konfirmasi Buang Perubahan`;
  - body stating that the changes will be lost;
  - confirm button `Ya, Buang Perubahan` in solid danger.
- A clean form leaves immediately.
- Leaving through the breadcrumb or the menu is **not** guarded.

**Do.** Treat the server's result as the source of every field error. Client-side
narrowing is convenience, not validation.

### 8.8 Document line tables — *Established*
- **Fixed layout:** 46px rows. Controls in a line use their small size (32px).
- **Over-limit row:** warning tint plus a small warning tag.
- **Removing a line:** an icon that turns red on hover. There is no confirmation,
  because the change is unsaved form state.
- **Adding lines** goes through a **picker dialog** that lists the eligible
  items. The form never adds a blank row.
- **Impact box:** bottom right of the line card, on a light band. A titled box
  lists label → mono figure rows stating what posting will do.
- **A line shows only what the user acts on.** What only helps check a line
  (the source's own figures, the account it posts to, what Post writes for it)
  goes in a *Rincian* dialog behind the line's `eye` action. A gap that blocks
  Post still shows on the line.
- **Readable, not squeezed:**
  - the line table keeps a floor width and scrolls inside its card, rather
    than squeezing the item column;
  - quantity and unit share one cell (`10 PCS`). The unit is a picker only when
    the item has more than one, otherwise text;
  - a picker inside a line row opens a list wider than itself (up to 440px),
    so codes and names are not clipped;
  - amount headings align right over their figures.
- **An optional value has no separate off switch.** For example, a discount is
  a field beside its % / Nominal toggle, and empty means none. An empty choice
  names itself, e.g. *Tanpa PPh*.

### 8.9 Inline vs modal editing — *Established*
- **Records are edited on their own page.**
  - No inline cell editing in lists.
  - No editing a whole record in a modal.
- **A modal collects input only for a decision that belongs to one step:**
  - classifying at approval;
  - choosing a resource when confirming;
  - picking lines;
  - picking a multi-attribute option;
  - entering a replacement password.

---

## 9. Modal / Drawer / Dialog Conventions

| Kind | Established? | Used for |
|---|---|---|
| Confirmation dialog | Yes | Every state change: lifecycle transition, activate/deactivate, reset |
| Modal (panel dialog) | Yes | Picking from a rich list, a step's decision, a breakdown |
| Popover: dropdown / calendar | Yes | Every picker and date field |
| Popover: row menu | Yes | Lifecycle actions on a register row |
| Popover: account menu | Yes | The topbar user chip |
| Inline interaction | Yes | §9.6 |
| Drawer / side sheet | **No** | Not part of the convention. Use the panel dialog (D22) |

### 9.1 Confirmation dialog — *Established*
**Purpose.** Stop a consequential step until the user accepts its effect.

**Structure.**
```
( tinted icon, 46px circle — red for danger, green for ok, brand for neutral )
Konfirmasi <Aksi>                    ← title
[ exact record, mono chip ]          ← subject
The consequence, stated.             ← body
[ optional input the step needs ]
[   Batal   ] [  Ya, <Aksi>  ]       ← equal width; confirm = primary or solid danger
```

**Interaction.**
- 384px wide, centred, over a dimmed, blurred backdrop.
- **Busy:** both buttons are disabled and the confirm button reads
  "Memproses…".
- **Dismiss:** Escape, or a mousedown **on the backdrop itself**. Dragging a
  text selection out of the dialog must not close it.

**Do.**
- Take the icon, title, body, confirm label and tone from the transition table.
- Use a **solid** danger confirm button for destructive steps.
- **A Post confirmation shows the journal it will write.**
  - It is a wide confirmation dialog with a journal preview, loaded by running
    the document's own posting path as a dry run, so it is the journal and not
    an estimate.
  - *Ya, Post* stays disabled until the preview has loaded.
  - A Post that would be refused says why, in the dialog: an unmapped account,
    a missing cost, an incomplete line.

**Don't.**
- Don't write "Apakah Anda yakin?". State the consequence.
- Don't build a second confirmation component.

### 9.2 Modal (panel dialog) — *Established*
**Purpose.** A focused task larger than one question.

**Structure.**
```
head  [34px tinted icon] Title / subtitle   [header control]   [× Tutup]
body  scrolls; may hold a sticky recap and a criteria bar explaining why items are eligible
foot  [running summary …]                            [Batal] [Primary]   ← concluding action rightmost
```

**Interaction.**
- **Size:** the width is set per dialog (up to 95vw); the height is at most
  86vh.
- **Scrolling:** only the body scrolls.
- **Dismiss:** same rules as the confirmation dialog.
- **Footer:** left out when the dialog concludes nothing, e.g. a breakdown shown
  only for information.
- **Selectable rows inside:**
  - a checkbox column;
  - chosen rows get an accent tint;
  - unavailable rows are faded;
  - a "select all" control sits in the header slot.

**Don't.**
- Don't draw a dialog header by hand.
- Don't leave out the close button.

### 9.3 Popover: dropdowns & calendar — *Established*
**Convention.**
- **Rendering:** the popover is rendered into the document body and positioned
  in viewport coordinates from its trigger's rectangle.
  - It opens downward, or flips upward when there is more room above.
  - It limits its height to the space available and scrolls inside itself.
  - It follows the trigger when an ancestor scrolls.
- **Closing:** it closes on an outside click, or on Escape.
- **Escape is caught in the capture phase**, so one press closes only the
  innermost layer.
- **Layering order (z-index):**

  | Layer | z-index |
  |---|---|
  | table header | 3 |
  | report sticky regions | 20 |
  | page header | 30 |
  | topbar | 40 |
  | account menu | 60 |
  | dialog backdrop | 90 |
  | row menu | 95 |
  | dropdown popover | 96 |
  | toasts | 100 |

  The dropdown sits above dialogs on purpose, so pickers work inside them.

**Don't.** Don't position a popover relative to its own control. A scrolling
container clips it.

### 9.4 Popover: account menu — *Established*
- Anchored under the user chip.
- Information first; the destructive "Keluar" last.

### 9.5 Popover: row menu — *Established*
**Convention.**
- A fixed menu placed under the "Aksi lain" trigger.
- **Header:** the record's number and status, then a divider.
- **Items:** available transitions, **safe first, danger last**. Danger items
  are red.
- **Closes** on an outside mousedown or on Escape.
- **Choosing an item opens the confirmation dialog.** Nothing runs directly from
  the menu.

### 9.6 Inline interactions — *Established*

| Interaction | Effect |
|---|---|
| Row click (list, tree data node) | opens the detail page |
| KPI tile click | sets the list filter, or opens a breakdown dialog |
| Chip click (report subjects, multi-select) | removes that item |
| Chevron / structure-row click | expands or collapses |
| Picker trigger click | the trigger itself becomes the search input |

A status badge is **display only**, never an inline trigger (*Decided, D14*).
Status is changed through a header button (§4.3) or the row's status toggle
(§5.2).

---

## 10. Common UI Components

### 10.1 Design tokens — *Established*
The shared stylesheet's tokens. Carry them into every project unchanged.

**Colour:**

| Role | Value |
|---|---|
| Brand (text, primary) | `#3E495A`, hover `#333D4C`; tints `#EEF1F5`, `#DDE2EA` |
| Accent (active, selected, focus) | `#DBC360` / `#D9B84C` / `#CBAA3E`; tints `#FBF7E8`, `#F3EAC4` |
| Rail | `#1D2633` |
| Background / surface | `#F4F6F8` / `#FFFFFF` |
| Lines | `#E2E8F0`, `#F1F5F9`, `#F8FAFC` |
| Ink / muted | `#1E293B`, `#3E495A` / `#64748B`, `#94A3B8`, `#CBD5E1` |
| ok | `#047857` · `#ECFDF5` · `#A7F3D0` · `#059669` |
| warn | `#B45309` · `#FFFBEB` · `#FDE68A` · `#D97706` |
| bad | `#BE123C` · `#FFF1F2` · `#FECDD3` · `#E11D48` |
| info | `#1D4ED8` · `#EFF6FF` · `#BFDBFE` |
| vio | `#6D28D9` · `#F5F3FF` · `#DDD6FE` |

The four values in each semantic row are: text · background · line · solid.

**Shape:**

| Token | Values |
|---|---|
| Radius | 6 / 9 / 12 / 18 |
| Shadows | five steps, `xs` → `xl`, slate-tinted |

**Type:**

| Token | Values |
|---|---|
| Families | Plus Jakarta Sans (UI) · JetBrains Mono (codes, numbers, money, ledger dates) |
| Base size | 13px / 1.5 |
| Micro-labels | 9–10.5px, uppercase, weight 800 |
| Page title | 19px / 800 |
| Card title | 13px / 800 |

**Heights:**

| Element | Height |
|---|---|
| Control | 34px (32px in line tables; 30px in report filters) |
| Button | 33px (28px small) |
| Table row | 38px |

**Focus:** a 2px accent outline. Inputs get an accent border plus a 3px pale
accent halo.

**Mono rule:** use mono for machine identity and figures (codes, document
numbers, money, rates). **Never** for people's or things' names.

### 10.2 Buttons — *Established*
**Variants:**

| Variant | Use |
|---|---|
| default | neutral actions: Ubah, Batal, Buka Semua, secondary header actions |
| primary | **the one** chief action of the screen, placed rightmost |
| danger (outlined red) | a destructive header action: Batalkan, Tolak |
| solid danger | **only** as the confirm button of a destructive confirmation |
| ghost | low-weight action: "Bersihkan filter" |

**Rules.**
- **Size:** 33px high, radius 9, weight 700; the small size is 28px; an
  icon-only button is square.
- **Disabled:** opacity .45 with no pointer events. When the reason isn't
  obvious, a tooltip explains it (e.g. "Tambahkan minimal satu …").
- **Icon:** at most one leading icon, 15px (13px on small buttons).
- **Label:** a verb.
- **Order:** in a header, `danger → neutral → primary`. Buttons of the same tone
  keep the order the transition table declares.

**Don't.**
- Don't decide a button's weight inline.
- Don't reorder buttons with CSS `order`: the tab order would stop matching the
  screen.
- Don't use two primaries in one header.

### 10.3 Status badges — *Established*
- **A solid badge is a status. A tinted badge is a tag.**
- **Shape:** 10px, weight 800, uppercase, radius 6.
- Keep one status-to-label-to-class map per project and read every status badge
  from it:

| Status meaning | Label | Class |
|---|---|---|
| Active | Aktif | solid ok (green) |
| Open / approved / in force | Open | solid ok |
| Posted / final-success | Posted | solid ok |
| Draft | Draft | solid warn (amber) |
| Submitted / waiting on someone | Diajukan / Menunggu … | solid info (blue) |
| Inactive | Non Aktif | solid bad (rose) |
| Rejected | Ditolak | solid bad |
| Closed | Closed | solid mute (slate) |
| Cancelled | Dibatalkan | solid mute |

- **Tags** use the tinted family: info, vio, warn, ok, bad, slate, accent.
- **A status badge is display only** (*D14*). No badge is a button.

### 10.4 Icons — *Established*
- **One icon component** draws from one closed set of stroke icons.
  **Every icon goes through it** (*Decided, D10*). Add a missing icon to the
  set; never inline an SVG.
- **Icon tints** (the coloured tile behind an icon, on KPI tiles, attention
  rows, empty states and dialogs) **come from tone classes**: ok, warn, bad,
  brand, info. **Never inline colour styles** (*Decided, D9*).
- **Sizes:**

  | Context | px |
  |---|---|
  | header tile | 16 |
  | buttons, card tiles | 15 |
  | row actions | 13–15 |
  | badges, chevrons | 11–12 |

- **Fixed meanings:**

  | Icon | Meaning |
  |---|---|
  | `eye` | view |
  | `pen` | edit |
  | `plus` | create |
  | `save` | save |
  | `back` | back / cancel |
  | `block` (×) | close |
  | `lock` | locked / denied |
  | `warn` | error / warning |
  | `check` | confirm / ok |
  | `chev` | expand / next |
  | `srch` | search, and `Tampilkan` |
  | `hist` | history (only) |
  | `more` (⋯) | "Aksi lain", the row menu trigger (D18) |
  | `gear` | status toggle / settings |
  | `expand` / `collapse` | Buka / Tutup Semua |
  | `print` | report output |

### 10.5 Alerts — *Established*
- An **inline explanation box**: icon, bold title, a short paragraph.
- **Variants:** info (blue), warning (amber), error (rose). A slim variant sits
  inside a card.
- Place it **next to the section the rule concerns**, not at the top of the
  page.
- A one-line notice strip (info or warning) is used for a single fact inside a
  dialog.

### 10.6 Notifications (toasts) — *Established*
- Stacked bottom-right, max 370px wide.
- **Auto-dismissed after 4.2 seconds**, with a manual `×`.
- **Kind** is shown by the left border: success green, error red, neutral brand.
- **Content:** a bold title plus one muted line.
- **Used for** the result of a save, a transition or a status change.
- **Never the only place an error appears.** Field errors are also inline.

### 10.7 Tooltips — *Established*
- Native `title` attributes on:
  - icon-only buttons ("Lihat detail", "Ubah", "Kosongkan", "Tutup");
  - disabled buttons, to say why;
  - truncated text;
  - one-letter flags.
- The only styled tooltip is the rail's module name.

**Don't.** Don't introduce a tooltip component (not established).

### 10.8 Dropdowns & reference pickers — *Established*

**Reference picker** (a record from another table):
- Options read `CODE – Name`.
- **Clicking the trigger turns it into the search input.** The popover holds
  only the list; it has no search box of its own.
- Keyboard: see *Both pickers* below.
- A clear button reads "Kosongkan".
- **Inactive records are hidden, except the one already selected.**
- No match shows "Tidak ada pilihan yang cocok."

**Dropdown** (a fixed list of values):
- It becomes searchable in the trigger, the same way, **once the list has more
  than 8 options**.
- **Trigger styles:** form field · toolbar filter · compact (pager and dense
  filters).
- An active filter trigger is accent-tinted.
- **Long lists of combinations:**
  - add group headings, sticky and opaque, with the options passed in already
    ordered by group;
  - add a wider list;
  - make the search match **every word** across label, hint and group.

**Both pickers:**
- **Selected option:** pale accent background plus a check tick.
- **Keyboard-highlighted option:** pale brand background.
- **One keyboard model for every list** (single pick, dropdown and multi-pick):
  - ↓ / ↑ move the highlight. Home / End do too, outside a search box.
  - Enter picks the highlighted option. Esc or Tab closes.
  - The highlight starts on the current value and follows the mouse. While
    searching, it moves to the first match.
  - A multi-pick stays open after each pick.
- **Unavailable option:** faded.
- `waitingFor` gives the "waiting" state; `disabled` gives the "never" state.

**Don't.**
- Don't use a native `<select>`.
- Don't put a search box inside the popover.
- Don't repeat in a chip a facet the option's label already states.

### 10.9 Date picker — *Established*
- **The field:** a text input that types and shows `dd/mm/yyyy`, with a
  calendar button ("Pilih tanggal"). **The calendar opens on focus.**
- **Calendar header:** « year, ‹ month, › month, » year.
- **Calendar grid:** 7 columns, **Monday first**. Today is outlined; the
  selected day is filled with the accent.
- **Calendar footer:** "Hari ini · dd/mm/yyyy" and "Kosongkan".
- A date that does not exist (e.g. 31/02) is refused.
- The value is ISO internally; only the display is local.
- **An editable date starts on today.** A system-derived date is left alone.
- **Date ranges:** two fields joined by "s/d". A reversed range is marked
  invalid.

**Don't.** Don't use `<input type="date">`. It follows the browser's locale.

### 10.10 Money & numeric input — *Established*
- **One numeric control** for every amount and every rate. It is:
  - mono and right-aligned;
  - labelled with its currency inside the box, on the left;
  - **grouped in thousands as the user types**.
- **`.` groups thousands and `,` separates decimals**, both on screen and on
  the keyboard. A `.` the user types is dropped, because the field inserts its
  own.
- An amount has 0 decimals by default. A rate has 6 decimals and a pair label
  (`USD → IDR`).
- A new field starts empty, showing a `0` placeholder, never a literal `0`.
- **Over-limit state:** warning colours.
- **Money of different currencies is never added up.** Totals are listed per
  currency: `Rp 45.000.000 · USD 3.500,00`.
- **Percent field:** the same control family, with `%` inside the box after the
  figure. It refuses any keystroke that would take it past 100, so it only ever
  holds 0–100 (discount %, tax rates, advance %).
- **A flat-amount toggle reads *Nominal*, never `Rp`.** A currency symbol
  misleads once a document can be in another currency.
- **Ledger figures** (journal, general ledger) read the accountant's way:
  - a negative is `(Rp 1.500.000)`;
  - an empty side is `—`;
  - **every figure carries its own currency**, never moved into a column
    header.

  One amount component and one format function do it.

**Don't.**
- Don't use `<input type="number">`.
- Don't create a second numeric control for rates.

### 10.11 Search
See §5.4 for lists, §6.1 for trees, and §7.3 for report subject pickers.

### 10.12 Filters
See §5.4 for lists and §7.3 for reports.

### 10.13 Pagination
See §5.6.

### 10.14 Destructive actions & confirmation flow — *Established* (hard delete: *Decided, D21*)
**The confirmation flow:**
1. A trigger: a header button, a row status toggle or a row-menu item.
2. The confirmation dialog, stating the consequence and naming the record.
3. The confirm button, which shows "Memproses…" while busy.
4. The server action.
5. A toast.
6. A refresh.

On failure the dialog closes and an error toast carries the server's message.

**Destructive intent, in order of preference:**

| Intent | Pattern |
|---|---|
| Retire master data | **Deactivate.** `Nonaktifkan` (danger, header) or the row status toggle. Body: the record disappears from new pickers, while history and references stay intact. Confirm: `Ya, Nonaktifkan` in solid danger |
| Stop a document | **Cancel or reject.** A danger header button, leftmost, or a danger item last in the row menu. Confirm in solid danger |
| Remove an unsaved line | A row icon that turns red on hover. No confirmation, because nothing is saved yet |
| **Hard delete** (only when a project truly needs it) | A danger header button **on the detail page**, leftmost. The confirmation title is `Konfirmasi Hapus <Entitas>`; the body says the deletion cannot be undone; the confirm button is `Ya, Hapus` in solid danger. **Never offered directly from a list row** |

**Don't.**
- Don't place a destructive button right of the primary.
- Don't confirm a destructive step with the outlined danger style. Inside the
  dialog the confirm is always **solid** danger.

### 10.15 Record history — *Established*
- **Placement:** one card, **the last card** on every saved record's page, in
  both view and edit. Title "Riwayat".
- **Timeline:** entries hang off one vertical rail. Each marker is tinted green
  for completing steps, red for destructive ones, and neutral for ordinary
  edits.
- **Each entry:** the event label and timestamp on one line, the actor below.
- **Automatic events** read "otomatis · dipicu oleh <user>".
- **Newest first, capped at 10.** When capped, say so: "Menampilkan 10 dari N
  aktivitas terakhir."
- It states who did what, and when. It never claims *what changed* unless the log
  actually stores it.

### 10.16 Cards & KPI tiles — *Established*
- **Card:** white, radius 12, 1px line, small shadow. Consecutive cards are 14px
  apart.
- **Card header:** 28px icon tile, title, an optional one-line description, and
  an optional right-aligned hint.
- **KPI tile:** a **button**. It has an uppercase label with a tinted icon, a
  large tabular value, a detail line, and "Rincian ›" when it opens something.
  Its icon tint comes from a tone class (D9).

### 10.17 Copy & language — *Established*
- The UI is **Indonesian**. Code, comments and commit messages are English.
- Established product terms stay in English inside Indonesian copy, e.g.
  Budget, Journal, Draft, Post.
- **Standard strings:**

  | Purpose | String |
  |---|---|
  | Create | `Tambah <Entitas>` / `Buat Dokumen` |
  | Save, cancel | `Simpan` · `Batal` |
  | Edit | `Ubah` |
  | Lifecycle | `Ajukan` · `Setujui` · `Tolak` · `Batalkan` · `Post` |
  | Run a report | `Tampilkan` |
  | Expand, collapse all | `Buka Semua` · `Tutup Semua` |
  | Back | `Kembali` |
  | Clear filters | `Bersihkan filter` |
  | Prompts | `Pilih <apa>…` · `Pilih <apa> dulu…` · `Cari <apa>…` · `Tambah <apa>…` |
  | Confirmation | title `Konfirmasi <Aksi>`, confirm button `Ya, <Aksi>`, body stating the consequence |
  | In / out direction | `Penerimaan` / `Pengeluaran`. Never the raw code values |
  | Busy | `Menyimpan…` · `Memproses…` |

- **Help text:** one lower-case clause, no full stop.
- **Report footnote:** one sentence.

---

## 11. Interaction & State Conventions

| State | How it is communicated |
|---|---|
| **Draft** | solid amber "Draft" badge; the document's date shows as a muted "belum diposting"; the KPI tile is amber-tinted; the header offers `Batalkan · Ubah · <transition>`. **Drafts never appear on a dashboard** |
| **Unsaved changes** | the pulsing "● Belum disimpan" chip in the header action slot; `Batal` asks before discarding them (D20) |
| **Success** | success toast; solid green status badges; incoming money in green; a green history marker |
| **Warning** | amber badge or tag; amber alert box; the over-limit state on amounts and line rows |
| **Error** | inline field error plus a red control; error toast; red alert box; an error card above the form; a red pill on an unbalanced report; negative money in red |
| **Disabled (never)** | a faded button whose tooltip gives the reason; `.dis` controls with a grey fill; faded options; a **lock chip** in place of actions on a final record |
| **Waiting (not yet)** | `.wait`, with an italic prompt `Pilih <apa> dulu…` |
| **Locked field** | read-only text with the "Terkunci" chip on its label; never a disabled control (D13) |
| **Loading / busy** | **No page-level loading UI** (no skeletons, no spinners). The control that started the work shows it: `Menyimpan…`, `Memproses…`, or a disabled `Tampilkan` or transition button |
| **Empty** | a page-level empty state, or a small one inside a section, dialog or report. Each has an icon tile, a heading, one explanation, and a CTA **only if the user can act**. Five meanings stay distinct: no data yet, no match, no access, not run yet, a genuine zero |
| **Selected** | accent family: the selected option with a tick, a picked row, the selected calendar day, the current page number, the active rail module; the active submenu leaf uses a light fill |
| **Active filter** | an accent-tinted trigger or chip, and the "Bersihkan filter (n)" button |
| **Active / inactive record** | green "Aktif" / rose "Non Aktif" badges; an inactive tree node is italic and muted; inactive records are hidden from pickers unless already selected |
| **Expanded / collapsed** | the chevron rotates 90° when open; a Buka Semua / Tutup Semua pair in the bar above the content (D7); trees start open, report blocks and breakdowns start folded |
| **Hover** | a pale row tint; tree and report row actions appear on hover; the rail tooltip appears |
| **Focus** | a 2px accent outline; inputs get an accent border and halo |

---

## 12. Responsive Conventions

**Stance:** desktop-first. The target is laptop and desktop. Below about 1080px
the layout keeps working but is not optimised.

| Area | Behaviour |
|---|---|
| Desktop | Full shell. The content area is the only scroll container. The page header stays sticky |
| ≤ 1320px | A two-column form grid collapses to one column |
| ≤ 1000px | Every form field takes the full row. A report block's summary strip wraps under its title |
| ≤ 860px | **A burger button appears in the topbar** and the rail and submenu become an off-canvas panel it opens, over a dimmed backdrop. Choosing a leaf or clicking the backdrop closes it (*Decided, D17*). Navigation must never be unreachable at any width |
| ≤ 640px | History timestamps stack under their event |
| Sidebar | The submenu collapses by its own button and returns when a rail icon is clicked. The rail never collapses |
| Tables | Scroll horizontally, with sticky headers. No stacked-card layout for mobile. Reports avoid horizontal scroll through column design, not breakpoints |
| Forms | 12-column rows down to 1000px, then single column. Control height never changes |
| Overflow | Long text is truncated with an ellipsis (help text keeps its full text in a tooltip). Header rows, action slots, toolbars and filter rows wrap. Dialog bodies scroll within 86vh. Popovers stay inside the viewport and scroll |
| Print | The shell, toolbars, pager, header actions and row actions are hidden, and the header stops being sticky. There is no print-sheet layout yet |

---

## 13. Inconsistencies & Open Decisions

### 13.1 Decision log

Decided on **24 September 2026**. Each decision settles a place where the
reference implementation did the same thing more than one way. **The decision
is the rule in every project**, even where the reference has not caught up yet.
The reference's own catch-up work is in `design-convention-update-plan.md` in
its repository (Appendix A).

| # | Topic | Decision | Rule in |
|---|---|---|---|
| D1 | Pager page numbers | Current page only, with the accent fill; the pager keeps a fixed width | §5.6 |
| D2 | "All" option in a filter | `<Filter>: semua`, toolbar trigger style | §5.4 |
| D3 | "Mode Ubah" badge | Amber tag, on every form | §4.2 |
| D4 | Batal button | `back` icon + text | §8.7 |
| D5 | Breadcrumb module segment | Plain text; the entity segment links to the list | §3.6 |
| D6 | Where reports sit in a module | Always a *Laporan* group | §3.5 |
| D7 | Expand-all control | A Buka + Tutup pair, in the bar above the content it controls, never in the header | §6.1, §6.2 |
| D8 | Empty state inside a report body | Small size | §7.8 |
| D9 | Icon tints | Tone classes, never inline colour styles | §10.4 |
| D10 | Icons | Always the icon component | §10.4 |
| D11 | Which lists paginate | Every list whose row count grows with use; built as one shared pager | §5.6 |
| D12 | Form container | Always single column | §4.2, §8.1 |
| D13 | Locked field in edit mode | Read-only text + "Terkunci" chip, never a disabled control | §8.5 |
| D14 | Changing status on a detail page | A header button (`Nonaktifkan` danger, `Aktifkan` neutral); badges are display only | §4.3, §9.6, §10.3 |
| D15 | Footnote length | One sentence, on lists as on reports | §4.1 |
| D16 | Unused styles (global search, topbar scope selector, command palette, per-column filters, leaf counts, header back button) | Delete them. Bring one back only through a recorded decision. The print-sheet styles stay until export is built | §3.2, §5.4 |
| D17 | Narrow-screen navigation | Build the burger and off-canvas navigation | §12 |
| D18 | Third row action | Keep the variation (masters: toggle; documents: row menu). "Aksi lain" gets its own `more` (⋯) icon; `hist` means history only | §5.2, §10.4 |
| D19 | Row-action alignment | Always reserve every slot | §5.2 |
| D20 | Discarding unsaved changes | Confirm on `Batal` when the form is dirty. Breadcrumb and menu are not guarded | §8.7 |
| D21 | Hard delete | Deactivate or cancel by default. A true delete is a danger button on the detail page, then a solid-danger confirmation. Never from a row | §10.14 |
| D22 | Drawers, tabs, custom tooltips, skeleton loading, column choosers | Not used. Use a panel dialog, stacked cards, native `title`, and busy state on the triggering control. No column chooser | §9, §10.7, §11 |

### 13.2 Still open

Nothing decides these yet. **Record a decision here before a project depends on
one.**

| # | Open item | Notes |
|---|---|---|
| O-C | Charts | No report uses one. Decide colours, type and placement when the first real case appears |
| O-B | Bulk actions on lists | Not used. Needs a selection model and bulk bar design when a real case appears |
| O-P | Print sheet & export layout | Buttons reserved left of `Tampilkan` (§7.9). The page layout for paper is undefined |

---

## 14. Implementation Examples

Reference implementation: `D:\Claude Code\Budget-Project`. Paths are relative to
`src/`. Copy these files' structure when you build the matching pattern.

| Pattern | Reference | Also compare |
|---|---|---|
| Design tokens & classes | `app/globals.css` | — |
| Shell & sidebar | `components/shell/app-shell.tsx` | `lib/siba/nav.ts` (navigation as data) |
| Master list | `components/master/entity-list.tsx` | `entity-pages.tsx` (list, new, view, edit routing) |
| Document register (KPIs, row menu) | `components/finance/transaction-list.tsx` | `transfer-list.tsx`, `budget/budget-list.tsx` |
| Tree list | `components/master/account-tree.tsx` | — |
| Tree rows inside a report | `components/report/statement-report.tsx` | — |
| Master form (new, view, edit) | `components/master/entity-form.tsx` | `settings/user-form.tsx` |
| Document form with lines | `components/finance/transaction-form.tsx` | `accounting/journal-form.tsx` |
| Detail-only page | `components/accounting/journal-detail.tsx` | `finance/funding-detail.tsx` |
| Form primitives | `components/ui/form.tsx` | — |
| Header button order | `lib/siba/header-actions.ts` | `lib/siba/transaction-workflow.ts` (transition table with tones) |
| Report chrome & run button | `components/report/report-view.tsx`, `report-run.tsx` | `lib/siba/reports.ts` (catalogue) |
| Report filters | `components/report/report-params.tsx` | `subject-params.tsx`, `fiscal-period-params.tsx` |
| Report body: ledger | `components/report/cash-bank-ledger-report.tsx` | `general-ledger-report.tsx` |
| Report body: statement | `components/report/statement-report.tsx` | `statement-title.tsx` |
| Summary strip | `components/report/report-summary.tsx` | — |
| Confirmation dialog | `components/ui/confirm-dialog.tsx` | — |
| Panel dialog | `components/ui/dialog.tsx` | `finance/budget-picker.tsx` (selectable rows), `finance/kurs-select.tsx` (multi-attribute choice) |
| Pickers & popover | `components/ui/combobox.tsx`, `select.tsx`, `multi-select.tsx`, `anchored-popup.tsx` | — |
| Date / money / rate | `components/ui/date-input.tsx`, `money-input.tsx`, `rate-input.tsx` | — |
| Search | `components/ui/search-field.tsx` | — |
| Scope filter | `components/master/company-filter.tsx` | — |
| Toast | `components/ui/toast.tsx` | — |
| Record history | `components/ui/record-history.tsx`, `record-history-card.tsx` | — |
| Empty, locked, denied | `components/master/entity-locked.tsx`, `auth/access-denied.tsx` | `report/report-view.tsx` (`ReportNeedsSubject`) |
| Login | `components/auth/login-form.tsx` | `app/forbidden.tsx` |
| Dashboard | `components/dashboard/dashboard.tsx` | — |
| Status vocabulary | `lib/siba/entities.ts` (`STATUS_TEXT`, `STATUS_CLASS`, `TAG_CLASS`) | — |
| Formatting | `lib/format.ts` | — |
| Enforcement test | `tests/design-system.test.ts` | — |

---

## Appendix A — Reference implementation status

The reference implementation does **not yet conform** to decisions D1–D20. The
work to bring it in line is planned file by file in:

`D:\Claude Code\Budget-Project\design-convention-update-plan.md`

**Until that plan is executed, where the reference and this document disagree
on a decided item, this document wins.** When copying a reference file (§14),
apply the decisions rather than the file's current behaviour.

D21 and D22 need no change in the reference.

## Appendix B — Relation to `Core_UI_Reference.md`

| Benchmark recommendation | Outcome in this convention |
|---|---|
| Per-column header filters | Not adopted; unused styles to be removed (D16) |
| Tree as the primary presentation of a hierarchy | Adopted (§6) |
| Balance strip under line items | Adapted as the impact box (§8.8) and the summary strip (§7.5). Balanced is never labelled |
| Layered picker family | Adapted: reference picker, dropdown and multi-select with in-trigger search, plus panel dialogs for rich choices |
| Two-line master cell | Not adopted for master references (one line). Used as the two-line descriptor for documents |
| Responsive root scale 12/14/16 | Not adopted: fixed px sizes |
| Search bar inside the dropdown | Rejected: the trigger is the search box |
| Escape does not close dropdowns | Fixed: Escape is caught in the capture phase |
| View mode as disabled inputs | Rejected (P4), including for locked fields in edit mode (D13) |
| Tabs for child collections | Not used: stacked cards |
| Audit trail in several places | Unified into the history card (§10.15) |
| Global header search | Not part of the convention (D16) |
