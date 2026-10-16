# Knowledge Base Adoption — SIBA 3.0 (Budget-Project)

What this project takes from the central knowledge base
(`D:\Claude Code\Knowledge-Base`), at which version, and with which choices.
The protocol is `PROTOCOL.md` there. Check this file with:

```bash
node "D:/Claude Code/Knowledge-Base/tools/kb-check.mjs" Budget-Project
```

SIBA is the **origin** of most concepts. The KB holds them in project-free
form; this repository remains their reference implementation.

## Adopted concepts

**Choice** is one of:
- `core`;
- `variant`, for a `~variant` row;
- `reference`;
- the options picked, as `name=value; name=value`.

**Local copy** is a path relative to this folder, or `—`. Adopted copies
live in `knowledge/`; `Initialization/` keeps the frozen originals. Put `pinned: <why>`
in **Note** to stay on an older version on purpose.

| Concept | Version | Choice | Local copy | Note |
| --- | --- | --- | --- | --- |
| foundations/working-method | 1.0 | guideline-file=CLAUDE.md | — | CLAUDE.md §1–§19 |
| foundations/document-lifecycle | 1.0 | core | — | §2, §10 rules 35–37, 63–65, 108 |
| engineering/app-architecture | 1.1 | tenancy=fixed-two-company | — | §3, §10 rule 1 |
| engineering/code-conventions | 2.1 | core | — | §7; §6 applied 04/10/2026 (vercel.json sin1, relationJoins) |
| engineering/data-conventions | 1.0 | doc-numbering=prefix-seq | — | §9 |
| engineering/security-rbac | 1.0 | core | — | §10 rules 9–13, §11. pinned: 2.0 (SSO, decided 05/10/2026) is adopted when the Portal identity provider exists; plan: AKUI-Project-Example/SSO-Portal-Plan.md |
| accounting/books-and-posting | 3.0 | core | — | §10 rules 22, 47–51; §6 is `npm run db:reconcile`; 3.0 §1.3 signed movement is CLAUDE.md §9 (origin) |
| accounting/subject-books | 1.0 | core | — | §10 rules 52–56, 103–107; origin |
| accounting/chart-of-accounts | 1.1 | control-account=derived | — | §10 rules 44–46, 77–80 |
| accounting/fiscal-periods-and-statements | 1.0 | core | — | §12; Initialization/Opening & Closing Update Phase.md |
| accounting/multi-currency | 1.1 | core | knowledge/CORE Multi Currency Concept.md | Extended by the variant below |
| accounting/multi-currency~rate-layers | 2.0 | variant | knowledge/SIBA Multi Currency Concept.md | §10 rules 69–72; 2.0 §7 (revaluation a user-triggered document, final) adopted 16/10/2026, built as Revaluasi Kurs (§10 rules 118–121) |
| budgeting/plan-to-realization | 1.0 | core | — | Origin; Initialization/Konsep SIBA 3.0 v3.md |
| ui/design-convention | 1.1 | form-layout=single-card | knowledge/design-convention.md | Origin of the convention. **Known gap:** the code breaks 20 of 22 decisions; design-convention-update-plan.md (proposed, not executed) closes it |
| ui/benchmark-study | 1.0 | reference | knowledge/akui_proto_ui_reference.md | |

## Local exceptions

Project rules that knowingly depart from an adopted concept for this project
only (PROTOCOL §4, answer D).

| Concept | Rule departed from | Project decision | Why |
| --- | --- | --- | --- |
| ui/design-convention | §5.3: lists have no row checkboxes, no select-all and no bulk bar | CLAUDE.md §12 "Approval and classification are two menus, each a work queue" (FROZEN, 30/09/2026) | The Budget module is its own convention: approver and classifier clear their queues in bulk, and status tabs make it safe. The user confirmed it as a local exception on 04/10/2026 (KB R7). |

## Harvest queue

Project decisions that look reusable and are waiting to be folded into the KB
(PROTOCOL §3).

| Project decision | Target concept | Proposed change | Status |
| --- | --- | --- | --- |
| Reklasifikasi Open Item (§10 rules 113–118, §12) | accounting/subject-books | New section: moving value between books. The target is posted as the original movement would have been — the same way opens one item per source item at its own kurs and base (value carried, no difference), the other way settles chosen items, each with its own FX line. Any category that names a Partner qualifies, no flag. It reclassifies items, never the plan. Also closes §5's "paths that lower without naming an item" for this path | Offered 07/10/2026 |
| Holding books come in pairs (§10 rule 113) | accounting/subject-books | A suspense book for unidentified money is two categories, one per direction: a book runs one way and never goes below zero, so receipts and payments held in one would cancel | Offered 07/10/2026 |
| A funded realization is a Realisasi without its cash (§10 rule 59, §12) | budgeting/plan-to-realization | §4: the child's document chooses its lines and open items exactly as the parent's; submitting checks the lines; the parent's confirmation states only the cash side (resource, layer or rate) and previews both journals; the bridge lines carry the cash line's own figures; every FX difference is the child's | Offered 14/10/2026 |
| Penyesuaian Open Item works like DN/CN against an existing item (§10 rules 97–102, 104, §12) | accounting/open-items (variant), accounting/subject-books | **Deviation from open-items §1**, which says a DNCN creates its own open item: where there is no invoice for a free-standing note to clear against, the note moves an existing open item instead — a new ledger line on that item, raising it (Debit Note) or lowering it (Credit Note), at the item's own rate, the way Oracle's Receivables Adjustment works. DN/CN are defined relative to the item they adjust (Credit = reduces, Debit = increases, in AR and AP alike), never by the side of the Partner's account. Proposed as a variant; kept locally as an exception until decided | Offered 15/10/2026 |
| A draft states what Post writes (§12 "Post is the actual boundary") | budgeting/plan-to-realization | A saved draft carries the base, rate and FX figures Post would write if it ran now, computed by the same valuation; Post re-values and writes them again. A funded draft states its settlement side only and leaves the cash side unwritten, the same in every currency | Offered 15/10/2026 |
