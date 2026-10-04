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
| engineering/code-conventions | 2.1 | core | — | §7. **Known gap:** §6 rules 1–2 not applied yet (no `vercel.json` region, no `relationJoins`); KB SYNC-PLAN 2B.7 |
| engineering/data-conventions | 1.0 | doc-numbering=prefix-seq | — | §9 |
| engineering/security-rbac | 1.0 | core | — | §10 rules 9–13, §11 |
| accounting/books-and-posting | 2.0 | core | — | §10 rules 22, 47–51 |
| accounting/subject-books | 1.0 | core | — | §10 rules 52–56, 103–107; origin |
| accounting/chart-of-accounts | 1.1 | control-account=derived | — | §10 rules 44–46, 77–80 |
| accounting/fiscal-periods-and-statements | 1.0 | core | — | §12; Initialization/Opening & Closing Update Phase.md |
| accounting/multi-currency | 1.1 | core | knowledge/CORE Multi Currency Concept.md | Extended by the variant below |
| accounting/multi-currency~rate-layers | 1.0 | variant | knowledge/SIBA Multi Currency Concept.md | §10 rules 69–72 |
| budgeting/plan-to-realization | 1.0 | core | — | Origin; Initialization/Konsep SIBA 3.0 v3.md |
| ui/design-convention | 1.1 | form-layout=single-card | knowledge/design-convention.md | Origin of the convention. **Known gap:** the code breaks 20 of 22 decisions; design-convention-update-plan.md (proposed, not executed) closes it |
| ui/benchmark-study | 1.0 | reference | knowledge/akui_proto_ui_reference.md | |

## Local exceptions

Project rules that knowingly depart from an adopted concept for this project
only (PROTOCOL §4, answer D).

| Concept | Rule departed from | Project decision | Why |
| --- | --- | --- | --- |

## Harvest queue

Project decisions that look reusable and are waiting to be folded into the KB
(PROTOCOL §3).

| Project decision | Target concept | Proposed change | Status |
| --- | --- | --- | --- |
