# SIBA 3.0 — Journal 2.0: Jurnal Umum, one journal for every money ledger

> **Status: steps 0–5 done (28/10/2026).** Every decision in §1
> and §9 is confirmed by the user. Progress is tracked in §10.

## Goal

One high-clearance journal, **Jurnal Umum**, where an authorised user can
record any movement that doesn't deserve a menu of its own, in **any ledger
measured in money**:

- the General Ledger;
- the subject books and their open items;
- Cash & Bank and its rate layers.

Post writes each ledger and the General Ledger together, so the two can never
drift apart. Users complain that today they "cannot just journal it"; every
niche case so far has needed a new menu.

**It is built open.** A ledger SIBA adds later plugs into the journal
through one contract (§3), with no change to the journal's tables.

SIBA is the test case. If the journal works in use, the concept goes to the
shared knowledge base (`accounting/books-and-posting`), and Jurnal Umum may
replace the manual journal (§8).

**Never in scope: ledgers measured in quantity** (stock, production,
capacity). Their entries need quantity, unit, location and cost, which a
money line cannot carry. No mainstream ERP posts them through its general
journal; they get a journal of their own.

**Mainstream basis.** Business Central's General Journal is the model: a line
has an *Account Type* (G/L Account, Customer, Vendor, Bank Account, …) and an
*Account No.*, applies to an open entry, and posting writes the subledger and
the G/L together. SAP (general posting + clearing) and Odoo (miscellaneous
entry + reconciliation) reach the same result.

---

## 1. Decisions (all confirmed 28/10/2026)

| # | Decision |
|---|---|
| D1 | **A line is filled Account → Ledger → Subject → Entry** *(revised 28/10/2026; supersedes "Book + Partner, account derived")*. The account is chosen first and brings its ledger (D18); an account without one touches no ledger. The user then picks the subject (a Partner, or a Cash & Bank) and its entry (an open item, or a layer) |
| D2 | **Ledgers in v1: GL, subject books, Cash & Bank.** Quantity ledgers never |
| D3 | **Its own menu and tables**, named **Jurnal Umum**. Post writes an ordinary posted `acc_journal`. **`acc_journal` and `acc_journal_line` do not change**, so the Neraca, Laba Rugi, General Ledger, Trial Balance and closing are untouched. **The new tables are a superset of the old ones** (§6), so they can later replace `acc_journal` without being reshaped |
| D4 | **Penyesuaian Open Item and Reklasifikasi Open Item are removed** *(revised 28/10/2026; supersedes "history kept readable")*: tables, registers and code go. Their code is kept on branch `snapshot/penyesuaian-reklas-2026-10-28`. Every transaction was emptied (`db:truncate-transactions`) on local and Neon on 28/10/2026, so no document of theirs remains |
| D5 | A raising subject-book line **opens a new item**, or **raises an existing Open item** the user names |
| D6 | **Currency and kurs on each line** *(revised 28/10/2026; supersedes one currency and kurs per journal and §4's journal-kurs valuation)*. The base currency's kurs is 1. A foreign line either **inherits** the kurs of the item or layer it releases or raises, or **writes** one. A new item, money arriving in a foreign Cash & Bank, and a foreign line on an account with no ledger must write one. A journal may hold several currencies; it balances in base, as `acc_journal` does |
| D7 | **All Selisih Kurs of a journal is netted into one line**, the rounding residue included. It arises only on a line that **writes** a kurs while releasing or raising an entry at the entry's own kurs: that line's share is `face × written kurs − face × entry kurs`. Post refuses a journal whose stated values don't balance in base, so the Selisih line can never absorb a typing mistake. A deliberate exception to rule 107 (per item, never netted), like Pencairan Open Item's rule 110 |
| D8 | **Every book that names a Partner may be written.** `allows_item_adjustment` is retired |
| D9 | Penyesuaian's counter accounts (`adjustment_income` / `adjustment_expense`) are **retired**; the user picks the counter account |
| D10 | **A foreign Cash & Bank line paying out names one layer; one journal may draw on several**, one per line. This relaxes rule 70 for this journal only |
| D11 | **Cash may move without a Budget.** This journal is the authorised exception to "Budget plans → Finance executes"; the permission is the control |
| D12 | **One high-clearance permission set** (`JOURNAL_GENERAL_VIEW / CREATE / EDIT / POST / CANCEL`), with no split by ledger. Draft → Post is the review step |
| D13 | **A line stores its subject generically** *(revised 28/10/2026)*: the ledger is read from the account (D18); the line keeps `partner_id`, `subject_id` (the open item, or the Cash & Bank) and `cash_bank_layer_id`, read and validated by the ledger's adapter. A new ledger needs no migration on the journal's tables. These references carry no database foreign key, except the layer: the same weak-reference pattern books already use for source documents |
| D14 | **Saldo baru helper, for every ledger.** A line may be entered as the balance its object should hold on the journal's date; the system turns it into a movement and a side. Stored as a movement, with `balance_before`; Post refuses if that balance has moved since the draft |
| D15 | **The manual journal (`JUR-`) stays as it is for now.** Jurnal Umum posts into the same `acc_journal`, so everything stays connected. If Jurnal Umum proves satisfactory, it replaces the manual journal (§8) |
| D16 | **A local exception for SIBA** to KB `books-and-posting` §4 ("a manual journal may not touch a control account"), recorded in KNOWLEDGE.md. Promote it to the knowledge base if it proves itself |
| D17 | **One object entry per line**: one item, or one layer. Settling three items means three lines |
| D18 | **The account names its ledger** *(confirmed 28/10/2026)*. `acc_account.require_partner` grows into `ledger`: `none`, `partner` (a Partner for the breakdown only, as today), `subject_book` (+ `ledger_book_id`: a Partner and an open item in that one book), or `cash_bank`. This is SAP's shape, where the GL account master declares itself a reconciliation account. Consequences: **one account, one book** (a mapping to an account of another book is refused, and existing data must be checked first); a Cash & Bank may post only to a `cash_bank` account; the ledger is locked once the account has a journal line; `is_control_account` becomes "the ledger is `subject_book` or `cash_bank`". It reverses rules 79–80's "derived from structure, never typed" |
| D19 | **The line's effect decides its entry and its kurs**, as on a Realisasi *(confirmed 28/10/2026)*. The effect is read from the **side** against the ledger's direction: a book's `raises`, or Cash & Bank where Debit is money in. ~~So the line is filled Account → **Sisi** → Subject → Entry → Currency → Kurs → Nominal, and changing the side clears the entry.~~ **Revised 28/10/2026 (user's instruction):** the line keeps the manual journal's **Debit and Kredit columns**, typed in the line's currency with its base value beside the filled one; the side is the column the amount is in. The fill order is Account → Subject → Entry → Currency → Kurs → Debit / Kredit, and an entry that moves only one way opens only that column: *Item baru* the book's raising side, a drawn layer Kredit, *Layer baru* Debit. **Lowering** (settling an item, drawing a layer): an entry is required, and its kurs is inherited; writing another produces Selisih. **Raising an existing item**: its kurs is inherited. **Raising a new item, or money arriving in a foreign Cash & Bank**: nothing to inherit, so the user types the kurs. A reclass carries value by typing the source item's kurs, which is shown on its own line. **Base currency**: 1, no choice. **The kurs is a number and nothing more** *(user's correction, 28/10/2026)*: it is prefilled from the subject by app logic, which every ledger's adapter supplies generically from what it already stores (an open item's kurs, a layer's kurs). No column records where it came from, and no line follows another. The one extra reference allowed is the Cash & Bank layer |

---

## 2. What it does and doesn't replace

| Stays its own transaction | Why it isn't a Jurnal Umum line |
|---|---|
| Realisasi Penerimaan / Pengeluaran | Realizes a Budget (`realized_amount`, closing it) |
| Funding Request | One event, two Companies' journals |
| Cash Bank Transfer, Pencairan Open Item | Routine work keeps its guided menu; Pencairan crosses two currencies (D6 is one currency) |
| Revaluasi Kurs | Collapses every layer of a resource; a batch operation, not a line |
| Fiscal closing, Opening Balance snapshot | Generated by the system |
| Budget | A plan, not a ledger |

What it replaces, or makes possible without a new menu:
- Penyesuaian Open Item and Reklasifikasi Open Item;
- AR/AP netting;
- crossing an open item into a Biaya, Pendapatan or any non-control account;
- a Cash & Bank correction or physical count, and a new resource's opening balance (replacing the "Saldo Awal" Budget workaround);
- tagihan biaya: accrued, paid at once, or owed to a Partner.

---

## 3. The open ledger contract

### 3.1 Pieces
- **The Jurnal Umum module.** It owns `acc_general_journal(_line)`, the engine (check, value, post, preview), the screens and the actions.
- **The account's ledger** (D18). `acc_account.ledger` says which ledger an account belongs to; an account with `none` touches no ledger.
- **One adapter per ledger, inside the Jurnal Umum module.** An adapter translates a journal line into its ledger's own exported functions. The books stay leaves that know nothing of the journal (module rule 3).
- **The adapter registry**, keyed by the `acc_account.ledger` value. The engine and the form are generic over it.

### 3.2 How a line is filled (D1, D19)

**Account → Subjek → Entri → Mata uang → Kurs → Debit / Kredit** *(revised
28/10/2026: the Sisi picker gave way to Debit and Kredit columns, D19)*. Each
field waits for the one before it (`waitingFor`, *Pilih <what> dulu…*), and
changing one clears the fields after it. The account decides the rest:

| `acc_account.ledger` | Subjek | Entri | Kurs |
|---|---|---|---|
| `none` | — | — | IDR: 1 · foreign: typed |
| `partner` | Partner, of a Partner Category the account admits | — | IDR: 1 · foreign: typed |
| `subject_book` (+ its book) | Partner, admitted by the book | **lowering**: an Open item, required · **raising**: an existing Open item, or *Item baru* | the item's, **read-only** · *Item baru*: typed (IDR: 1) |
| `cash_bank` | a Cash & Bank posting to this account | **money out, foreign**: a layer, required · **money in, foreign**: *Layer baru* · rupiah: none | the layer's, **read-only** · *Layer baru*: typed · IDR: 1 |

Whether a line raises or lowers is read from its **Sisi** against the
ledger's direction: a book's `raises`, or Debit = money in for Cash & Bank. It
is never chosen. The currency follows the subject where the subject has one
(an item, a resource), and is chosen otherwise.

How a line is stored (§6): `partner_id` for a Partner;
`subject_id` = the open item (null for *Item baru*) or the Cash & Bank;
`cash_bank_layer_id` = the layer. Nothing records where a kurs came from: it
is a number, filled by the adapter.

### 3.3 What an adapter declares

```ts
type LedgerAdapter = {
  ledger: string;                                   // an acc_account.ledger value
  // form
  subjectOptions(account, ctx);                     // Partners / Cash & Banks
  entryOptions?(account, side, subject, ctx);       // open items / layers, and "baru"
  effect(account, side): "raise" | "lower";         // from the ledger's direction
  kurs(line): number | null;                        // the subject's own kurs, read-only; null = typed
  // rules
  check(line, ctx): string[];                       // refusals, each naming what is wrong
  base(line): number;                               // face × kurs; a clearing release hands back the exact remainder
  balance?(line, date): number;                     // present ⇒ Saldo baru (D14)
  // posting
  lockKeys(line): { rank: number; key: string }[];
  write(tx, line, ctx): Promise<void>;              // through the ledger's own writer
  // D18 consistency
  accountFits?(account, use): string | null;        // e.g. a mapping or a Cash & Bank naming this account
};
```

`none` needs no adapter. `partner` only checks the Partner (it writes no
book). `subject_book` and `cash_bank` write their books.

### 3.4 The adapters in v1

| | `partner` | `subject_book` | `cash_bank` |
|---|---|---|---|
| Writer | — (journal only) | `recordSubledgerEntry` (`Adjustment`) | `recordCashBankEntry` (`Adjustment`), `openLayer` / `drawFromLayer` |
| Lock rank | — | 1, `lockSubledgerPosition` | 2, `lockCashBanks` |
| `balance` | account + Partner on the date | the item on the date | the resource on the date |
| `accountFits` | — | a mapping from a book-keeping category must target an account of **that** book | a Cash & Bank may post only to a `cash_bank` account |

Both book enums already have `Adjustment`, which nothing in the application
writes today. **No enum change is needed.**

### 3.5 Engine flow
- **Save (Draft):** run each line's `check`, fill each kurs the adapter supplies, compute each line's base, then the Selisih (§4), and store the figures Post will write.
- **Post, in one transaction:**
  1. `holdPostingPeriod`;
  2. collect every line's `lockKeys`, sort them by rank and key, and take them all;
  3. re-read every entry and every `balance_before`, refusing by name anything that moved;
  4. each adapter's `write`;
  5. write the `acc_journal`. Its lines **equal the draft's lines**, the Selisih row included;
  6. `postJournal`, the status, and `posted_journal_id`.
- **Dry run:** the same steps, rolled back, give the `JournalPreview` on the Post confirmation.

### 3.6 Control accounts under D18
- `is_control_account` becomes **"the account's ledger is `subject_book` or `cash_bank`"**, plus the System Account claims as today.
- The plain manual journal (`JUR-`) still refuses a control account.
- Jurnal Umum accepts any account, because the account's ledger then demands its subject.
- The ledger is locked once the account has a journal line.
- `syncControlAccounts` and `controlAccountReasons` read it from the account instead of from the mappings and resources.

### 3.7 Plugging in a future ledger — the whole checklist
1. Add its value to `acc_account.ledger`. One enum value on the account, never a change to the journal's tables.
2. Its book exports a writer, a lock and a balance-on-date reader.
3. Write its adapter and add it to the registry.
4. Its source-document link, through `documentHref`.
5. Its tests (§7).

---

## 4. Valuation

**A line's base is `round(face × kurs)`.** Where an entry clears, the release
hands back the entry's exact remaining base instead, as every book does. The
kurs is 1 for the base currency, the subject's own kurs where it has one
(read-only), and typed otherwise (D6).

**Selisih Kurs (D7):**
```
for each foreign currency c in the journal:
  if Σ face debit(c) = Σ face kredit(c):
      gap(c) = Σ base kredit(c) − Σ base debit(c)     // FX, by construction
Selisih = Σ gap(c)  →  one line on the Company's fx account:
          positive: Debit (a loss) · negative: Kredit (a gain) · zero: no line
then: Σ debit = Σ kredit over every line, Selisih included, or Post refuses
```

The last check catches everything else: a mistake in a rupiah line, or a
foreign currency whose amounts don't balance and which therefore can't be read
as FX. The refusal names the currency. A typing mistake can never reach the
Selisih line. Rounding residue sits inside the gaps and needs no handling of
its own.

---

## 5. Simulations

Example data: Company ABHC; Partner **PT Sinar Abadi**, admitted by Hutang,
Piutang and Titipan; Partner **Lainnya** in Penerimaan Belum Teridentifikasi
(PBT). Every case starts from this state.

| Object | Account (ledger) | Holds | Kurs |
|---|---|---|---|
| SBI-0101 | 1.1.3.2 Piutang Usaha (Buku Piutang) · PT Sinar | Rp 10.000.000 | 1 |
| SBI-0201 | 2.1.1.3 Hutang Usaha (Buku Hutang) · PT Sinar | USD 1.000 | 15.800 |
| SBI-0305 | 1.1.3.2 Piutang Usaha (Buku Piutang) · PT Sinar | USD 600 | 16.400 |
| SBI-0410 | 2.1.5.1 Titipan Belum Teridentifikasi (Buku PBT) · Lainnya | USD 500 | 16.000 |
| Kas Kecil | 1.1.1.1.1 Kas Kecil (Kas & Bank, IDR) | Rp 2.350.000 | — |
| BCA USD, layer CBLY-0007 | 1.1.1.2.3 Bank BCA USD (Kas & Bank, USD) | USD 2.000 | 15.900 |

**Case 1 — Lower an item into an expense (a Credit Note).**

| Account | Sisi | Subjek · Entri | Nominal | Kurs | Debit | Kredit |
|---|---|---|---|---|---|---|
| Piutang Usaha | Kredit (melunasi) | PT Sinar · SBI-0101 | IDR 2.000.000 | 1 | | 2.000.000 |
| Beban Lain-lain | Debit | — | IDR 2.000.000 | 1 | 2.000.000 | |

SBI-0101 → 8.000.000. With **Saldo baru** the user types 8.000.000 on the item
line and the system fills in Kredit 2.000.000.

**Case 2 — Raise a foreign item (a Debit Note).** A USD 50 late fee on SBI-0201.

| Account | Sisi | Subjek · Entri | Nominal | Kurs | Debit | Kredit |
|---|---|---|---|---|---|---|
| Hutang Usaha | Kredit (menambah) | PT Sinar · SBI-0201 | USD 50 | 15.800 (item, read-only) | | 790.000 |
| Beban Lain-lain | Debit | — | USD 50 | typed | | |

The user types 15.800: Debit 790.000, no Selisih, identical to today's
Penyesuaian. The user types 16.200: Debit 810.000. USD balances (50 = 50), so
the gap is 790.000 − 810.000 = −20.000, which writes a **Kredit Selisih 20.000**.

**Case 3 — AR/AP netting.**

| Account | Sisi | Subjek · Entri | Nominal | Kurs | Debit | Kredit |
|---|---|---|---|---|---|---|
| Hutang Usaha | Debit (melunasi) | PT Sinar · SBI-0201 | USD 600 | 15.800 (read-only) | 9.480.000 | |
| Piutang Usaha | Kredit (melunasi) | PT Sinar · SBI-0305 | USD 600 | 16.400 (read-only) | | 9.840.000 |
| Selisih Kurs | | computed | | | 360.000 | |

No kurs is typed anywhere. The difference is fixed by the two items:
600 × (16.400 − 15.800). SBI-0201 → USD 400; SBI-0305 cleared.

**Case 4 — Move held money to its book.**

| Account | Sisi | Subjek · Entri | Nominal | Kurs | Debit | Kredit |
|---|---|---|---|---|---|---|
| Titipan Belum Teridentifikasi | Debit (melunasi) | Lainnya · SBI-0410 | USD 500 | 16.000 (read-only) | 8.000.000 | |
| Titipan | Kredit (menambah) | PT Sinar · Item baru | USD 500 | typed | | |

The user types 16.000: the new item is 8.000.000, the value is carried, and no
Selisih arises (today's Reklas). The user types 16.300: 8.150.000, and a
**Debit Selisih 150.000**.

**Case 5 — Opening balance of a new Cash & Bank.** BCA Operasional (IDR),
registered with Saldo Awal 0.

| Account | Sisi | Subjek · Entri | Nominal | Kurs | Debit | Kredit |
|---|---|---|---|---|---|---|
| Bank BCA Operasional | Debit (uang masuk) | BCA Operasional | IDR 50.000.000 | 1 | 50.000.000 | |
| Modal Disetor | Kredit | — | IDR 50.000.000 | 1 | | 50.000.000 |

The book entry and the journal are written together, with no Budget.

**Case 6 — Foreign bank charge.**

| Account | Sisi | Subjek · Entri | Nominal | Kurs | Debit | Kredit |
|---|---|---|---|---|---|---|
| Beban Adm. Bank | Debit | — | USD 15 | 16.100 (typed) | 241.500 | |
| Bank BCA USD | Kredit (uang keluar) | BCA USD · CBLY-0007 | USD 15 | 15.900 (layer, read-only) | | 238.500 |
| Selisih Kurs | | computed | | | | 3.000 |

CBLY-0007 → USD 1.985. Cases 3 and 6 in one journal give the netted Debit
357.000 shown in the mockup.

**Case 7 — Physical cash count.** Kas Kecil holds 2.350.000 and 2.300.000 is
counted. Saldo baru 2.300.000 on a Kas Kecil line gives Kredit 50.000 (uang
keluar) / Debit Beban Selisih Kas 50.000. The per-day "never below nothing"
check applies at Post.

**Case 8 — Tagihan biaya.**
- Accrued at month end: Debit Biaya Listrik / Kredit Biaya YMH Dibayar, both `none` accounts.
- Paid at once: Debit Biaya ATK / Kredit Kas Kecil (uang keluar).
- Owed to a Partner: Debit Biaya Jasa / Kredit Hutang Usaha · PT Sinar · *Item baru*.

**Case 9 — Partner breakdown with no book.** Debit · Beban Pemasaran (a
`partner` account) · PT Sinar 5.000.000 / Kredit Biaya YMH Dibayar 5.000.000.
The General Ledger shows PT Sinar on the line, as today's `require_partner`
does; no book is written.

**Case 10 — Something moved while the draft waited.** The Case 3 draft holds
`balance_before` USD 1.000 for SBI-0201, and a Realisasi pays USD 300 of it.
Post refuses and names SBI-0201. The same applies to a resource balance under
Saldo baru.

**Case 11 — Refused: a currency crossing.** Debit Hutang Usaha · SBI-0201 USD
100 (15.800, read-only) = 1.580.000 / Kredit Kas Kecil IDR 1.620.000. USD
doesn't balance (100 against 0), so its gap is not FX. The journal doesn't
balance in IDR (1.580.000 against 1.620.000), so Post refuses, naming USD. A
foreign item paid from a rupiah account is a Realisasi Pengeluaran.

---

## 6. Data model

**Built as an expansion of the current journal (user's requirement,
28/10/2026).** Every column of `acc_journal` and `acc_journal_line` appears in
the new tables under the **same name and type**, and the extension columns sit
beside them. The netted Selisih Kurs is stored as a line of its own, so after
Post the rows of `acc_general_journal_line` equal the `acc_journal_line` rows
Post wrote, one for one. While both tables exist, `posted_journal_id` links the
two.

Replacing the old journal later (§8) is then a change of **where the rows
live**, never of their shape:
1. copy the `acc_journal` history across as `ledger = 'gl'` lines;
2. point the readers (`ledger.ts`, `opening-balance.ts`, `closing.ts`) and the writer (`postJournal`) at the new tables;
3. drop `posted_journal_id`.

```dbml
table acc_general_journal {
  id                          int [pk, increment, not null]

  // ── the columns of acc_journal, unchanged ──
  journal_no                  varchar(255) [not null, unique]  // JUM-0001
  accounting_date             date
  posted_at                   timestamptz [default: `transaction_timestamp()`]
  // Null on a Jurnal Umum. Kept so that, once this table replaces acc_journal,
  // every posting document writes its journal here with its own source.
  source_doc_type_id          int [ref : >? sys_doc_type.id]
  source_doc_id               int
  company_id                  int [not null, ref : > sys_company.id]
  description                 text [not null]
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']
  is_manual                   boolean [not null, default: true]

  // ── extension ──
  // Currency and kurs live on each line (D6), exactly where acc_journal_line
  // already keeps them; the header carries none.
  // The journal Post wrote, while acc_journal is still the ledger. Dropped on
  // replacement.
  posted_journal_id           int [unique, ref : - acc_journal.id]

  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    (company_id, accounting_date)
    (source_doc_type_id, source_doc_id)
  }
}

table acc_general_journal_line {
  id                          int [pk, increment, not null]

  // ── the columns of acc_journal_line, unchanged ──
  journal_id                  int [not null, ref : > acc_general_journal.id]
  sequence_no                 int [not null]
  // Chosen first, always. The account brings its ledger (acc_account.ledger,
  // below); an account without one touches no ledger.
  account_id                  int [not null, ref : > acc_account.id]
  // The subject on a 'partner' or 'subject_book' account, and the Partner
  // breakdown the old journal already had.
  partner_id                  int [ref : >? m_partner.id]
  currency_id                 int [not null, ref : > ref_currency.id]
  // The number in the line's Kurs field: 1 for the base currency; the
  // subject's own kurs, read-only, where the subject holds one (an open item,
  // a layer); typed only for something new (D6). No column says which.
  exchange_rate               decimal(18,6) [not null, default: 1]
  // Base currency, exactly as Post writes it to acc_journal_line. Since a
  // derived kurs cannot be overridden, every line here equals its posted
  // acc_journal line, kurs included.
  debit_amount                decimal(18,2) [not null, default: 0]
  kredit_amount               decimal(18,2) [not null, default: 0]
  // The face amount the user typed, in the journal's currency.
  trx_amount                  decimal(18,2) [not null]
  description                 text [not null]

  // ── extension ──
  // The ledger is read from the account, never stored here. A weak reference,
  // read and checked by that ledger's adapter (D13), and the source of the
  // kurs the line inherits (D19):
  //   subject_book → subject_id = sub_ledger_balance.id, the open item
  //                  (null: a new item for partner_id)
  //   cash_bank    → subject_id = m_cash_bank.id
  subject_id                  int
  // Cash & Bank only: the rate layer a foreign payment draws on. The one
  // extra reference a ledger is allowed (D19).
  cash_bank_layer_id          int [ref : >? cash_bank_layer.id]
  // Saldo baru as typed (D14), and the balance it was typed against; Post
  // refuses if the object no longer holds balance_before.
  new_value                   decimal(18,2)
  balance_before              decimal(18,2)
  // The one netted Selisih Kurs line (D7), written by the system on every save.
  is_generated                boolean [not null, default: false]

  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `transaction_timestamp()`]
  updated_at                  timestamptz [not null, default: `transaction_timestamp()`]

  indexes {
    journal_id
    account_id
    (account_id, subject_id)
    cash_bank_layer_id
  }
}

// ── change to an existing table: the account names its ledger (D18) ──
table acc_account {
  // ...existing columns...
  // Replaces require_partner. 'none': no subject. 'partner': a Partner is
  // required, for the breakdown only (today's require_partner). 'subject_book':
  // a Partner and an open item, in ledger_book_id's book. 'cash_bank': a Cash &
  // Bank resource. Locked once the account has a journal line.
  ledger                      enum('none', 'partner', 'subject_book', 'cash_bank') [not null, default: 'none']
  // The book, when ledger = 'subject_book'. One account, one book.
  ledger_book_id              int [ref : >? sys_budget_category.id]
  partner_category_id         int [ref : >? sys_partner_category.id]  // unchanged
}
```

A `sys_doc_type` row for Jurnal Umum (system data, seeded). Book entries and
the journal name the document as their source.

---

## 7. Steps

Each step ends green on `npm run build`, `npm run lint` and `npm test`.

| Step | Work | Done when |
|---|---|---|
| **0 Prep** | Settle §9; cancel or post any Draft PYO- / RKL-; **check the mappings for an account two books share, and Cash & Bank accounts used for anything else** (D18 needs one account, one ledger); check whether registering a Cash & Bank with a Saldo Awal also writes a journal; add the local exception to KNOWLEDGE.md | Nothing open blocks step 1 |
| **1 Schema** | The two tables; `acc_account.ledger` + `ledger_book_id`, migrated from `require_partner`, the mappings and the Cash & Bank resources; the doc type; the permissions in the catalogue; `SIBA DBML.md` | Migrated and seeded; every existing account reads the ledger it was already acting as |
| **2 Engine, `none` and `partner`** | The contract, the registry, check / value / post / dry run, the per-currency Selisih; `is_control_account` and `syncControlAccounts` reading the account's ledger; mappings and Cash & Bank checked against it; the account form asks for the ledger, and `acc_account.require_partner` is dropped once its readers (`ledger.ts`, `journal.ts`, `manual-journal.ts`, `records.ts`, `master.ts`, `entities.ts`, `opening-balance.ts`, tests, showcase) read `ledger`, its migration re-running step 1's backfill first | A rupiah Jurnal Umum of plain and Partner accounts posts a journal identical to the same manual journal; Case 9 passes; `JUR-` still refuses a control account. **Gate A** |
| **3 `subject_book` adapter** | Items: raise, settle, *Item baru*; read-only kurs; Saldo baru; `balance_before` | Cases 1–4, 10 and 11 pass as tests; the preview equals the written journal. **Gate B** |
| **4 `cash_bank` adapter** | Resource, layer per line, per-day check, opening a layer on money in | Cases 5–7 pass; a layer overdrawn refuses; the rollback leaves the layer unspent. **Gate C** |
| **5 Screens** | Register, form (the line's ledger picks its pickers from the adapter), Rincian per line, Saldo baru, `JournalPreview`; `DOCUMENT_SCREENS`, `POSTING_FORMS`, nav | `ui-audit` against the Journal and Penyesuaian screens |
| **6 Retire and rewire** | Penyesuaian and Reklas removed entirely: tables (a migration), routes, registers, actions, permissions, doc types (D4); `allows_item_adjustment` and `adjustment_*` dropped; `reclassTrail`, `documentHref`, `document-numbers`; `seed-showcase`, `reconcile-books`, `truncate-transactions`, `module-boundaries` | The suite passes; `db:reconcile` agrees |
| **7 Documentation** | CLAUDE.md: rules 70, 79–80, 97–102, 107, 113–117, the manual-journal, control-account and Penyesuaian / Reklas decisions in §12, the module in §3; this plan's progress | |
| **8 Trial in use** | Users work with it; collect what goes wrong | Then §8's decision, and the KB harvest |

---

## 8. Later: replacing the manual journal

D15 says that, if Jurnal Umum is satisfactory, it replaces the manual journal
and becomes the source of everything the old journal is the source of. That
can mean two things, to be decided then:

- **(a) Replace the menu (recommended).** Jurnal Umum becomes the only way to
  write a journal by hand, since a GL-only Jurnal Umum *is* a manual journal.
  `acc_journal` stays the one ledger every report reads and every posting
  document writes. This is Business Central's shape (General Journal Line →
  G/L Entry). The cost is retiring `JUR-` drafts and moving its users over.
- **(b) Replace the store.** The reports read Jurnal Umum's tables. Every other
  posting document (Realisasi, Transfer, Funding, …) would then have to write
  into them too, which moves the General Ledger itself. That is a large change
  with no gain, because the posted `acc_journal` already is the journal.

---

## 9. Settled (28/10/2026)

All three proposals accepted as written.

| Item | Decision |
|---|---|
| Series | `JUM-`, beside `JRN-` (automatic) and `JUR-` (manual) |
| Menu place | Accounting › Journal › **Jurnal Umum**, beside Journal, since it now reaches the General Ledger itself |
| Saldo baru on a `gl` line refuses whenever anything posts to the account in the meantime | Accept: re-open and save again (D14) |

---

## 10. Progress

| Step | State | Notes |
|---|---|---|
| Decisions D1–D19 | Confirmed 28/10/2026 | D1, D6, D7 revised; D18, D19 added |
| §9 open items | Settled 28/10/2026 | All three accepted |
| 0 Prep | Done 28/10/2026 | 28/10/2026, local and Neon alike: **no account is mapped from two categories, and no Cash & Bank account is used by a mapping, a System Account or `require_partner`**, nor by a manual journal line, so D18's migration needs no cleanup. **One Draft, PYO-0003**, no Draft RKL-. **Registering a Cash & Bank with a Saldo Awal writes an `Opening` book entry dated today and no journal** (`openCashBankBook`), so the General Ledger holds that figure only through an Opening Balance snapshot; Jurnal Umum's Case 5 is the route that writes both. Local exception added to KNOWLEDGE.md. PYO-0003 resolved by D4's revision: every transaction emptied on both databases; the showcase is reseeded at step 6, once it no longer creates PYO / RKL |
| 1 Schema | Done 28/10/2026 | Migration `20261028114823_general_journal`: enum `AccountLedger`, `acc_account.ledger` + `ledger_book_id` (CHECK: a book exactly when `subject_book`), backfilled; it refuses an account that would need two ledgers. Local and Neon alike: 5 `cash_bank`, 26 `subject_book` across 8 books, 114 `none`, no `partner`, and every ledger agrees with today's `is_control_account`. `require_partner` kept beside it until step 2; nothing reads `ledger` yet. Doc type *Jurnal Umum*, `JOURNAL_GENERAL_*`, `truncate-transactions` clears the two tables, `SIBA DBML.md` updated |
| 2 Engine + `gl` (Gate A) | Done 28/10/2026 | Migration `20261028150000_account_ledger_replaces_require_partner` re-runs step 1's backfill and drops `acc_account.require_partner`; every reader asks `ledgerTakesPartner` (`account-code.ts`). The account form asks **Ledger** (+ Buku Subjek, + Partner Category), locked once the account has a journal line and refused while a Cash & Bank or mapping it serves would no longer fit. `is_control_account` = the ledger is `subject_book` / `cash_bank`, plus System Account claims; a Cash & Bank needs a `cash_bank` account, a book's mapping an account of that book, a non-book mapping a non-book account. Engine in `general-journal.ts` (check, draft, Post + dry run, cancel), valuation and the netted Selisih in `general-journal-valuation.ts`, the contract and registry (`partner` only) in `general-journal-ledgers.ts`; a ledger with no adapter refuses by name. `tests/general-journal.test.ts`: Case 9 identical to the manual journal, the draft's rows equal the posted ones, Cases 2/3/6/11 valuation, a foreign Selisih line, JUR- still refuses a control account. No Server Action or screen yet (step 5). **Neon not migrated yet** |
| 3 `subject_book` (Gate B) | Done 28/10/2026 | `subject_book` adapter in `general-journal-ledgers.ts`. The side against the book's `raises` decides raise or lower (D19); a lowering names an Open item and relieves it at its own kurs, exactly as `recordSubledgerEntry` will; a raise grows a named item at its kurs or opens *Item baru* at the typed one, for a Partner the book admits. A named item's typed kurs is ignored. Every named item stores `balance_before` (its balance on the journal's date, `itemBalanceOn` in `subledger.ts`), re-checked at Post before the transaction and again under `lockSubledgerPosition`; **Saldo baru** (`new_value`) becomes the side and amount. Book entries are `Adjustment`, sourced to the Jurnal Umum. The contract grew `subjectId` / `newValue` / `balanceBefore` / `baseAmount` on the line, `takesNewValue`, and the account on `lockKeys` / `write`. `tests/general-journal.test.ts`: Cases 1 (by Saldo baru), 2, 3, 4, 10, 11, a lowering without an item or past what it holds, and the preview equal to the written journal |
| 4 `cash_bank` (Gate C) | Done 28/10/2026 | `cash_bank` adapter in `general-journal-ledgers.ts`. `subject_id` is a Cash & Bank posting to the line's own account, in its currency; Debit is money in. A foreign payment names one open layer (`cash_bank_layer_id`) acquired on or before the date, takes its kurs and draws its exact base; a foreign receipt opens a new layer at the typed kurs; a rupiah resource takes kurs 1 and no layer. Money out is checked against every day since (`cashBankShortfall`) at save, and again by `recordCashBankEntry` under `lockCashBanks` (rank 2, after the subject books). **Saldo baru** reads `cashBankBalanceOn` (new in `cash-bank.ts`, from the month chain) and holds to `balance_before`. Entries are `Adjustment`. Post turns `InsufficientFunds` and `LayerNotAvailable` into a refusal. Tests: Cases 5–7, a receipt opening a layer, Saldo baru refused once the resource moved, a missing or overdrawn layer, a rupiah overdraft, and a Post whose second draw overdraws refusing with the first draw rolled back. **Known gap:** two lines drawing the same layer or item are each checked alone at save; only Post catches their sum |
| 5 Screens | Done 28/10/2026 | Accounting › Journal › **Jurnal Umum** (`/accounting/jurnal-umum`): register, and one form for new / view / edit. A line reads Account → Subjek → Entri → Currency → Kurs → Debit → Kredit → Saldo Baru → Keterangan, the amount typed in the line's currency in the column of its side with its ≈ base beneath (the user's layout, D19); the Subjek and Entri pickers come from the account's ledger, an entry's kurs is read-only, and *Item baru*, a drawn layer or *Layer baru* opens only the column it can move. The base figures and the one Selisih line are previewed with `valueGeneralJournal` and the fx kernel, from the options' current figures (the server values on the journal's date). View: Debit / Kredit in `Amount ledger`, a **Rincian** dialog per ledger line (book, effect, entry, layer, kurs, saldo sebelum / baru), and the Post confirmation's `JournalPreview` from the dry run. `general-journal-workflow.ts` (lifecycle), `general-journal-rows.ts` (register, detail, options), `app/actions/general-journal.ts`; `documentHref` and `document-numbers` name `JUM-` on book entries. In `DOCUMENT_SCREENS` and `POSTING_FORMS`. Exercised in the browser on the production build (draft saved, edit reloaded, Post preview, Rincian), then removed; `ui-audit` against Penyesuaian and the manual journal: the differences left are the screen's own (no Jenis facet; the references had no documents). **Accepted:** the editor's table is wider than its card at 1600px, so Keterangan scrolls; the register is paged in the browser (`shortcut:` in the list) |
| 6 Retire and rewire | Not started | |
| 7 Documentation | Not started | |
| 8 Trial in use | Not started | |
