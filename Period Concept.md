# Period Concept — `cash_bank_period`

> SIBA 3.0 · table since migration `20261020094548_cash_bank_period` (20/10/2026)
> Code: `src/lib/siba/cash-bank.ts` (`ensurePeriod`, `checkMovement`, `movePeriods`, `openingsAt`)
> Rules: CLAUDE.md §12 *"A document may be backdated, never dated ahead"*.
> Companion document (user-facing, Indonesian): `Saldo Per Hari - Konsep dan Penggunaan.md`.

This document explains one table: what it holds, how its rows come into being, and how
every document that moves cash — above all **Realisasi** and **Cash Bank Transfer** —
leans on it to decide whether a movement is allowed, and how the reports read from it.

---

## 1. The problem it solves

A Cash & Bank resource may never hold less than nothing. Before backdating, that was a
one-row check: read `cash_bank_balance`, subtract the payment, refuse if negative.

Backdating broke that. A payment dated in the past lowers the balance on **its own
day and on every day after it**. So the question is no longer "is today's balance
enough?" but:

> Is the balance enough on **every day** from the document's date until today?

Answering that naively means replaying the resource's whole book from its first entry,
on every Post. That grows without limit. `cash_bank_period` is the summary that lets the
question be answered by reading **one month of entries plus one aggregate**, however old
the book is.

---

## 2. What the table is

One row **per Cash & Bank resource per calendar month**. Primary key
`(cash_bank_id, period)`, where `period` is the first day of the month.

| Column | Meaning (in the resource's own currency) |
| --- | --- |
| `opening` | Balance at the start of the month |
| `total_in` | Sum of money in during the month |
| `total_out` | Sum of money out during the month (positive figure) |
| `closing` | `opening + total_in − total_out` |
| `min_balance` | **The lowest the balance stood at any moment of the month, the opening included** |
| `base_opening`, `base_total_in`, `base_total_out`, `base_closing` | The same four in IDR, for reports only |

Three invariants hold at all times:

1. **The chain links.** Next month's `opening` = this month's `closing`.
2. **The chain is unbroken.** Every month from the resource's first entry's month to its
   latest entry's month has a row — including months with no movement (they carry the
   balance through: `opening = closing = min_balance`).
3. **No month goes below zero.** `min_balance ≥ 0` on every row.

`min_balance` is the column that does the real work; the other figures are what the
reports need.

### What it is *not*

- **Not `acc_fiscal_period`.** It is keyed on the calendar month, not on a Company's
  fiscal period. The Cash Bank Book is a leaf module that depends on nothing (CLAUDE.md §3),
  and a fiscal year may be missing (2028 Open while 2027 does not exist) — the chain must
  still be unbroken. Whether a date is *allowed* to be posted into is the fiscal calendar's
  question, asked separately (`holdPostingPeriod`, see §6).
- **Not a source of truth.** `cash_bank_ledger` is. Every figure in this table can be
  re-derived from the ledger entries (that is exactly what reconcile check 19 does).
- **Not editable by anything but the book.** Only `recordCashBankEntry` writes it,
  inside the same database transaction as the ledger entry.

---

## 3. Where it sits among the tables

```
                     Realisasi (fin_cash_bank_transaction / _line)
                     Funding confirmation (fin_funding_request)
  documents   ───►   Cash Bank Transfer (fin_cash_bank_transfer / _line)
  (callers)          Pencairan Open Item (fin_item_conversion)
                     Revaluasi Kurs (fin_cash_bank_revaluation)
                     Cash & Bank registration (Saldo Awal)
                                   │
                                   │  recordCashBankEntry(tx, entry)   ← the only door
                                   ▼
        ┌──────────────── Cash Bank Book (lib/siba/cash-bank.ts) ───────────────┐
        │                                                                       │
        │  cash_bank_period   ← checked first, then moved   (per month)         │
        │  cash_bank_ledger   ← one entry appended          (per movement)      │
        │  cash_bank_balance  ← running total updated       (per resource)      │
        │                                                                       │
        └───────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼ (read by)
              Buku Kas & Bank, Saldo Kas & Bank reports  (openingsAt)
              scripts/reconcile-books.ts check 19
```

| Table | Relation to `cash_bank_period` |
| --- | --- |
| `m_cash_bank` | Foreign key `cash_bank_id`. A resource has 0..n month rows; none until its first entry |
| `cash_bank_ledger` | The entries a month row summarises. `Σ movement` of a month's entries = `total_in − total_out`; the latest month's `closing` = `Σ movement` of the whole book |
| `cash_bank_balance` | The current balance. Equals the `closing` of the resource's latest month (entries cannot be dated after today, so the latest month is the current one or earlier) |
| `cash_bank_layer` | Independent. Layers check *which parcel* of foreign currency is spent and its remainder; the chain checks the *total* never goes below zero on any day (§5.4) |
| `acc_fiscal_period` | No link. The fiscal period decides whether a date may be posted; the chain decides whether the cash is there on that date |
| Document tables (`fin_*`) | No link. Documents reach the chain only through `recordCashBankEntry`; the ledger entry carries the weak `(source_doc_type_id, source_doc_id)` pair back to them |

---

## 4. How the data is collected

Nobody inserts a month row directly. It is maintained as a side effect of every ledger
entry, in three steps inside `recordCashBankEntry`:

```
recordCashBankEntry(tx, entry)
  1. lockCashBanks(tx, [resource])          advisory lock, held until the tx ends
  2. movePeriods(...)
       a. checkMovement(...)                read-only: throws InsufficientFunds if refused
       b. ensurePeriod(...)                 extend the chain to cover the entry's month
       c. update the entry's month          total_in / total_out, closing, min_balance
       d. shift every later month           opening, closing, min_balance  += movement
  3. insert cash_bank_ledger row, update cash_bank_balance
```

Nothing is written unless step 2a passes, and everything is in the caller's transaction,
so a later refusal anywhere in the posting rolls the chain back too.

### 4.1 `ensurePeriod` — keeping the chain unbroken

| Situation | What is created |
| --- | --- |
| Resource has no month yet | One row for the entry's month, all zeros |
| Entry dated **before** the first month | Rows from the entry's month up to the first month, all zeros (nothing was held then) |
| Entry dated **after** the latest month | Rows from the month after the latest up to the entry's month, each carrying the latest `closing` as `opening = closing = min_balance` |
| Entry inside the chain | Nothing |

### 4.2 Updating the entry's own month

- Money in → `total_in += amount`; money out → `total_out += amount`.
- `closing += movement`.
- `min_balance` = the new lowest point, computed by `checkMovement` while replaying the
  month (see §5.1).
- The four `base_*` columns move by the base figure. A **Revaluasi Kurs** entry moves no
  currency (movement 0) and only base; it is counted on the out side, as the Buku Kas &
  Bank report places it, and leaves `min_balance` alone.

### 4.3 Shifting every later month

A movement dated in month M changes the balance on every day after it, so every month
after M moves by exactly the same amount:

```
opening     += movement
closing     += movement
min_balance += movement      ← the lowest point of a later month shifts by the same amount
```

One `UPDATE … WHERE period > M`. No entries are read.

### 4.4 Existing data

The migration that created the table back-filled it from `cash_bank_ledger` with one SQL
statement, so it is correct on a database that already held entries.
`npm run db:truncate-transactions` empties it together with the books.

---

## 5. How it is used in a transaction

### 5.1 The check (`checkMovement`)

For a movement dated `d` in month M:

**Step 1 — inside month M.** Read only M's entries, ordered `(entry_date, id)`. Start
from M's `opening` and replay them, placing the new movement **last on its day** (as the
reports order it). For money out, find the lowest the balance stands **from day `d`
onwards**; if that minus the payment is below zero → refused, naming that day:

> Saldo Cash & Bank tidak mencukupi pada 05/01/2026: tersedia 20, dibutuhkan 50.

**Step 2 — every month after M.** All of them shift by the same movement, so one
aggregate answers for all of them:

```
MIN(min_balance) over months > M   +   movement   ≥ 0
```

If not → refused, naming the month:

> Saldo Cash & Bank tidak mencukupi pada bulan 02/2026: tersedia 70, dibutuhkan 80.

**Money in is never refused** — it can only raise later balances. It is still replayed,
because it may change M's `min_balance`.

**Cost:** one month of entries + one indexed aggregate, regardless of how many years the
book holds.

### 5.2 Worked example

Resource **BCA IDR**, in 2026:

| Date | Document | Movement |
| --- | --- | --- |
| 01/01 | Registration (Saldo Awal) | +100 |
| 05/01 | RBK-0001 (Realisasi Pengeluaran) | −80 |
| 20/01 | RBM-0001 (Realisasi Penerimaan) | +200 |
| 10/02 | TRF-0001 (Transfer out) | −150 |
| 03/03 | RBM-0002 | +30 |

The chain:

| period | opening | in | out | closing | min_balance |
| --- | --- | --- | --- | --- | --- |
| 01/01/2026 | 0 | 300 | 80 | 220 | 0 |
| 01/02/2026 | 220 | 0 | 150 | 70 | 70 |
| 01/03/2026 | 70 | 30 | 0 | 100 | 70 |

(January's minimum is 0 because the opening, before the Saldo Awal entry, counts.)

Now three backdated payments are attempted:

| Payment | Step 1 (its own month) | Step 2 (later months) | Result |
| --- | --- | --- | --- |
| 50 dated **03/01** | From 03/01 on, January's lowest is 20 (on 05/01). 20 − 50 < 0 | — | **Refused** "pada 05/01/2026" |
| 80 dated **25/01** | From 25/01 on, January stands at 220. OK | `MIN(70, 70) − 80 = −10` | **Refused** "pada bulan 02/2026" |
| 50 dated **25/01** | 220 − 50 = 170. OK | `70 − 50 = 20 ≥ 0` | **Posted** |

After the 50 is posted, the chain reads:

| period | opening | in | out | closing | min_balance |
| --- | --- | --- | --- | --- | --- |
| 01/01/2026 | 0 | 300 | **130** | **170** | 0 |
| 01/02/2026 | **170** | 0 | 150 | **20** | **20** |
| 01/03/2026 | **20** | 30 | 0 | **50** | **20** |

Exactly what a full replay of the book would give, without one.

### 5.3 Locking and ordering

Two postings on the same resource must not both pass on the same read. So
`recordCashBankEntry` takes a transaction-scoped advisory lock per resource
(`lockCashBanks`, key `cash_bank:<id>`). A document that writes several resources takes
all their locks first, **in id order**, so a transfer A→B and one B→A posted at the same
moment cannot deadlock.

Lock order inside one posting is always:

```
fiscal period (holdPostingPeriod)  →  subject-book positions (lockSubledgerPosition)  →  Cash & Bank (lockCashBanks)
```

### 5.4 Foreign-currency resources

The chain runs on `movement`, i.e. in the resource's own currency (USD for a USD
account) — exactly like an IDR account. Two other checks sit beside it, in
`cash-bank-layers.ts`:

| Check | Question |
| --- | --- |
| `drawFromLayer` — remainder | Does the chosen layer still hold this much? |
| `layerDateRefusal` — date | Was the chosen layer acquired on or before the document's date? |
| `cash_bank_period` — chain | Does the account as a whole stay ≥ 0 on every day from the date on? |

Because a layer cannot be used before it was acquired and cannot go below zero, the layer
checks usually refuse first on a foreign account. The chain stays as the guarantee.

---

## 6. Realisasi and the chain

**Realisasi Penerimaan (`RBM-`) / Realisasi Pengeluaran (`RBK-`)** — table
`fin_cash_bank_transaction` + `_line`. Code: `applyPosting` and `writeRealizationLines` in
`src/lib/siba/finance.ts`.

### 6.1 What a Realisasi writes into the book

One Cash Bank Book entry **per line (per Budget)**, all dated by the document's Tanggal
Dokumen, all on the header's Cash & Bank (CLAUDE.md §10 rule 54). So a Realisasi
Pengeluaran of three Budgets is three `Out` entries on one day, and the chain is checked
and moved **three times**, line by line:

```
applyPosting(doc)
  checkTransactionDate(...)          date ≤ today, in an Open period of the Company
  planPosting(...)                   values every line (amounts, kurs, FX)
  cashShortfall(...)                 PREVIEW: Σ line amounts vs. the chain (Out only)
  if dryRun → return journal         ← the Post confirmation stops here
  $transaction:
    holdPostingPeriod                lock the fiscal period, re-check it
    lockPlanPositions                lock the subject-book positions the lines lower
    writeRealizationLines, per line:
      drawFromLayer (foreign Out)    layer remainder + layer date
      recordCashBankEntry  ────────► lock resource → checkMovement → move chain
                                     → ledger entry → cash_bank_balance
      openLayer (foreign In)
      subject-book entries
    realize Budgets, post journal, mark Posted
```

### 6.2 When the chain is asked

| Moment | How | Effect |
| --- | --- | --- |
| **Simpan draft** | Not asked. The line card's `Saldo Saat Ini · Total Digunakan · Sisa` strip shows *today's* balance only | A backdated draft may look covered and still be refused |
| **Open the Post confirmation** | `cashShortfall` → `cashBankShortfall`: the same `checkMovement`, for the **sum of all lines** (they are one day's entries, so the total is the whole question), no lock, no write | The refusal appears inside the dialog and **Ya, Post** stays disabled |
| **Post** | `recordCashBankEntry` per line, under the lock | Authoritative. Any refusal throws `InsufficientFunds` and the whole posting rolls back — chain, ledger, layers, books, journal, Budgets |

A **Penerimaan** is never refused by the chain; it only lifts later months.

### 6.3 Funding confirmation (the anak's Realisasi)

The anak's document names no Cash & Bank. When the induk confirms the Funding Request
(`writeFundedPosting`), the **induk's** chosen resource is written through the same
`writeRealizationLines`, so the chain checked and moved is the **induk's resource**, on the
anak's Tanggal Dokumen. The funded preparation (`prepareFundedPosting`, which the
confirmation's preview also runs) asks the same `cashBankShortfall` before the button is
pressed.

---

## 7. Cash Bank Transfer and the chain

**Cash Bank Transfer (`TRF-`)** — table `fin_cash_bank_transfer` + `_line`. Code:
`applyTransfer` in `src/lib/siba/transfer.ts`. Purposes: Transfer, Pencairan, Pembelian
Valas.

### 7.1 What a Transfer writes into the book

- **One `Out` entry on the source**, for the whole document — the money left the source
  once, however many destinations (CLAUDE.md §10 rule 89). So the source's chain is
  checked and moved **once**, for the total.
- **One `In` entry per destination line.** Each destination's chain is extended and
  moved; it is never refused (money in).

```
applyTransfer(doc)
  checkTransactionDate(...)
  $transaction:
    holdPostingPeriod
    lockCashBanks([source, ...destinations])   all resources, id order
    planTransfer                               draws source layers (foreign source)
    recordCashBankEntry(source, Out, total) ─► checkMovement on the SOURCE chain
    if dryRun → throw TransferDryRun           ← preview stops here, rolled back
    per line:
      recordCashBankEntry(dest, In, amount) ─► move the DESTINATION chain
      openLayer (foreign destination)
    journal, mark Posted
```

### 7.2 When the chain is asked

| Moment | How |
| --- | --- |
| **Simpan draft** | Not asked |
| **Open the Post confirmation** | A real dry run: the transaction opens, the source entry is written (so `checkMovement` runs exactly as at Post), then the transaction is rolled back. A shortfall on any day shows in the dialog |
| **Post** | Same path, committed |

Because the dry run stops **right after the source entry**, the preview is refused in
exactly the place Post would be.

### 7.3 Same-day destinations, different accounts

Each destination has its own chain. A transfer of 100 from BCA to Mandiri dated 15/01
moves BCA's chain down by 100 from January onward, and Mandiri's chain up by 100 from
January onward — extending Mandiri's chain backwards to January first if its first
entry was later.

### 7.4 Pencairan Open Item

`applyConversion` (`src/lib/siba/item-conversion.ts`) has the same cash shape as a
Pencairan transfer: one `Out` on the foreign source, one `In` per Rupiah destination,
same locks, same dry run. The chain behaves exactly as in §7.1–7.2.

---

## 8. Other writers

| Writer | Entry | Chain effect |
| --- | --- | --- |
| Cash & Bank registration (`openCashBankBook`) | `Opening`, money in, dated the registration date | Creates the resource's first month(s). A negative Saldo Awal is refused outright |
| Revaluasi Kurs (`applyRevaluation`) | `Revaluation`, movement 0, base only | Moves only the `base_*` columns of its month and later months; currency and `min_balance` untouched, never refused by the chain |
| Penyesuaian / Reklasifikasi Open Item | — | Move no cash. They never touch the chain |

---

## 9. How it is used in reporting

**Buku Kas & Bank** and **Saldo Kas & Bank** (Finance › Laporan) need each resource's
balance at the start of the chosen range `from`. `openingsAt(ids, from)`:

```
opening at `from` =
    month row of `from`  ? its `opening`
                         : `closing` of the latest month before `from`   (nothing moved since)
  + Σ movement of ledger entries from the 1st of that month up to the day before `from`
```

Then the period's own entries are summed (or listed) on top:

```
closing = opening + in − out          (both measures, IDR and the resource's currency)
```

So a report for March 2030 reads one month row and a few days of entries for its
opening, never four years of ledger. The result equals a full scan exactly
(`tests/cash-bank.test.ts`).

The reports **do not print a running balance**: once entries may be backdated in among
entries written earlier, the `balance_after` stored on a ledger row is the balance at the
moment of writing, not at its date.

The **Kekurangan** strip on a Realisasi / Transfer form reads `cash_bank_balance`
(today's balance), not the chain — which is why the Post confirmation, not the strip, is
the deciding answer for a backdated document.

---

## 10. Proving it is right

| Tool | What it does |
| --- | --- |
| `npm run db:reconcile`, **check 19** | Rebuilds every month of every resource from `cash_bank_ledger` in SQL and compares it with `cash_bank_period`: missing month, extra month, any figure different on either measure, or `min_balance < 0`. Read-only, safe on Neon |
| `tests/cash-bank.test.ts` | The 03-Jan case, a chain extended backwards, backdated money in lifting every later month, two crossed transfers posted concurrently, report openings equal to a full scan |
| `tests/finance.test.ts`, `tests/transfer.test.ts`, `tests/item-conversion.test.ts` | The Post previews refuse a backdated shortfall the same way Post does |

There is deliberately no `rebuildCashBankPeriods` function. If check 19 ever fails, delete
the resource's rows and re-run the back-fill SQL from the migration.

---

## 11. Summary for the reader

1. **One row per resource per month**, unbroken, linked opening → closing, with the
   month's **lowest point**.
2. **Only `recordCashBankEntry` writes it**, in the same transaction as the ledger entry,
   under a per-resource lock.
3. A movement dated `d` is checked by **replaying `d`'s month** and testing
   **`MIN(min_balance) + movement ≥ 0` over later months** — then the entry's month is
   updated and every later month shifted by the movement.
4. **Realisasi** checks and moves the chain **once per Budget line**; its Post
   confirmation checks the **sum** in advance. **Funding** does the same on the induk's
   resource.
5. **Transfer** (and Pencairan Open Item) checks the **source once for the total** and
   moves **each destination** up; its Post confirmation is a real dry run.
6. **Reports** take their opening from the chain plus a few days of entries.
7. It is a **summary, never the truth**: the ledger is, and check 19 proves the two agree.
