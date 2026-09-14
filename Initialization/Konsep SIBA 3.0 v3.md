# SIBA 3.0 — Core Concept v3
## Architecture, Business Chain, Multi-Book, Accounting Relationship & Intercompany Funding

**Baseline:** pembaruan dari *Konsep SIBA 3.0 v2* dengan integrasi konsep **Company Treasury Provider / Funding Request**.

> **Prinsip utama SIBA 3.0 v3: Budget merencanakan → Finance merealisasikan → jika Company membutuhkan treasury dari Company lain, Realisasi menghasilkan Funding Request → Treasury Provider mengonfirmasi Funding → actual posting menghasilkan Journal masing-masing Company secara bersamaan → General Ledger dan operational books dapat direkonsiliasi.**

**Baseline:** pembaruan dari dokumen *Konsep SIBA 3.0* dengan klarifikasi konsep yang dibahas setelah baseline.

> **Prinsip utama SIBA 3.0: Budget merencanakan → Finance merealisasikan → banyak buku mencatat event secara paralel → Accounting menghasilkan Journal secara otomatis → General Ledger dan operational books dapat direkonsiliasi.**

---

## 1. Tujuan

SIBA 3.0 memastikan setiap modul/menu memiliki fungsi dan hubungan yang jelas dari planning sampai actual accounting.

Scope:

- **Master** — reference, entity, resource, currency, dan subject.
- **Budget** — planning dan approval.
- **Finance** — actual execution melalui Cash Bank In/Out.
- **Accounting** — Journal otomatis, General Ledger, operational books, dan reconciliation.

Perubahan inti dari baseline adalah konsep **true multi-book**:

> Journal Line, General Ledger, Cash Bank Book, Prive Ledger, Titipan Ledger, Hutang Ledger, dan Piutang Ledger adalah record/book yang berbeda.

Operational books **tidak dibentuk dengan membaca, memfilter, atau menyimpan Journal/Journal Line**.

---

# 2. Core Principles

### 2.1 Budget adalah planning

Budget hanya menyediakan planned amount dan business classification.

Budget tidak membuat:

- Cash/Bank movement;
- Journal;
- General Ledger;
- operational ledger movement.

### 2.2 Finance adalah execution

Cash Bank In/Out mengubah planning menjadi actual transaction.

Finance menarik Budget yang sudah Open dan eligible berdasarkan transaction context.

### 2.3 Post adalah actual boundary

Saat Post:

```text
Draft / planned execution
        ↓
       POST
        ↓
Actual transaction
```

Setelah Post, transaction immutable sesuai boundary yang telah ditetapkan.

### 2.4 Satu business event dapat menulis ke banyak buku

Contoh Pengeluaran Prive:

```text
Cash Bank Out
      │
      ├── Cash Bank Book
      ├── Prive Ledger
      └── Journal
              │
              └── General Ledger
```

Record pada masing-masing book dibuat terpisah.

### 2.5 Operational book bukan Journal view

Tidak boleh ada model:

```text
Journal Line
    ↓
Hutang Ledger
```

atau:

```text
Hutang Ledger = filter Journal Line
```

Hutang, Piutang, Titipan, Prive, dan Cash Bank mempunyai historical store sendiri.

### 2.6 General Ledger adalah pengecualian yang disengaja

General Ledger memang merupakan accounting book yang berasal dari Journal Lines.

```text
Journal
  ↓
Journal Lines
  ↓
General Ledger
```

---

# 3. Arsitektur Besar

```text
MASTER
  │
  ├── Company
  ├── Currency
  ├── Cash Bank
  ├── Partner
  └── Partner Category
  │
  ▼
ACCOUNTING CONTROL
  ├── Fiscal Period
  ├── COA
  └── BP / Subledger Configuration
  │
  ▼
BUDGET
  ├── Budget Month
  └── Budget
        │
        ▼
     Approval
        │
        ▼
       Open
        │
        ▼
FINANCE
  ├── Cash Bank In
  └── Cash Bank Out
        │
        ▼
      POST
        │
        ├───────────────┬────────────────┐
        ▼               ▼                ▼
 Cash Bank Book   Subject Books       Journal
                  ├── Prive               │
                  ├── Titipan             ▼
                  ├── Hutang         General Ledger
                  └── Piutang
```

Setiap book menyimpan history sendiri.

---

# 4. Master

## 4.1 Company

Company adalah entity/ownership context.

Digunakan oleh Budget, Finance, operational books, Journal context, dan reconciliation.

```text
Company
  ↓
Budget.Company
  ↓
Finance.Company
  ↓
Book.Company
```

## 4.2 Currency

Currency menjadi reference transaksi.

Simulasi saat ini:

```text
Base Currency = IDR / Rupiah
```

Struktur konsep tetap membedakan:

- transaction currency;
- transaction amount;
- exchange rate;
- base currency;
- base amount.

## 4.3 Cash Bank

Cash Bank adalah resource tempat uang berada.

Contoh:

- Kas;
- Bank Mandiri;
- Bank BCA.

Setiap Cash Bank memiliki historical **Cash Bank Book** sendiri.

Budget tidak memilih Cash Bank.

## 4.4 Partner

Partner adalah business subject.

Contoh:

- Prive A / B;
- Cabang A / B;
- Titipan A / B.

Partner Category menentukan domain subject.

---

# 5. Accounting Control

## 5.1 Fiscal Period

Fiscal Period menyediakan period control untuk Budget Month dan accounting posting/reporting.

## 5.2 Chart of Accounts

COA adalah struktur account accounting.

Contoh:

```text
1101 Kas
1102 Bank Mandiri
1103 Bank BCA
1201 Piutang
2101 Hutang
2102 Titipan
3101 Prive
```

**COA adalah subjek utama General Ledger.**

## 5.3 BP / Subledger Configuration

COA dapat dikonfigurasi membutuhkan BP/subject:

```text
COA
  ↓
Has BP
  ↓
BP Category
  ↓
Partner
```

Konfigurasi ini tidak menjadikan operational book sebagai turunan Journal.

---

# 6. Budget

Budget adalah planning layer.

## 6.1 Budget Month

Budget Month hanya container:

```text
Fiscal Period
  ↓
Budget Month
  ↓
Many Budgets
```

Budget Month tidak mempunyai approval, realization, atau accounting movement sendiri.

## 6.2 Budget

Create:

```text
Date
Company
Type
Description
Amount
```

Type:

- Penerimaan;
- Pengeluaran.

Pada creation belum ada Cash Bank, Purpose, atau Journal.

## 6.3 Approval / Classification

Reviewer menentukan:

```text
Category
Partner (jika required)
```

Category menentukan Partner Category yang valid.

## 6.4 Lifecycle

```text
Draft
  ↓ Submit
Submitted
  ├── Reject → Draft
  └── Approve → Open
                   ↓
                 Closed
```

Open membuat Budget immutable.

## 6.5 Realization

Satu Budget dapat direalisasikan berkali-kali.

```text
Budget = 10M
  ├── Realization 1 = 4M
  ├── Realization 2 = 3M
  └── Realization 3 = 3M
```

Jika realization mencapai nominal Budget, Budget dapat auto-close sesuai rule.

Over-realization diperbolehkan; closure tetap mengikuti rule yang ditetapkan dan tidak mengubah historical transaction.

---

# 7. Category

Category adalah business classification pada Budget.

Category bukan Purpose.

```text
Budget
  ↓
Category
  ↓
Allowed Partner Category
  ↓
Partner
```

Contoh:

```text
Titipan → Partner Category Titipan
Prive   → Partner Category Prive
Hutang  → Partner Category Cabang
Piutang → Partner Category Cabang
```

---

# 8. Purpose

Purpose berada di Finance dan merepresentasikan specific business event.

Contoh:

```text
Penerimaan Titipan
Pengeluaran Titipan
Penerimaan Prive
Pengeluaran Prive
Penerimaan Hutang
Pembayaran Hutang
Penerimaan Piutang
Pengeluaran Piutang
```

Purpose dapat menentukan di application layer:

- Finance Type;
- Budget Type yang eligible;
- Budget Category yang eligible;
- Partner requirement;
- operational book yang menerima record;
- accounting mapping.

Database tidak harus mengetahui seluruh business rule tersebut; application layer menjadi sumber konfigurasi/logic.

---

# 9. Finance

Finance adalah execution layer.

Context utama:

```text
Company
Cash Bank
Purpose
Partner (jika required)
Currency
```

Budget eligible minimal harus memenuhi:

```text
Status = Open
Company sesuai
Type sesuai Purpose
Category sesuai Purpose
Partner sesuai bila required
```

Budget Month dan Budget Date bukan validator utama eligibility.

Tanggal dapat dipakai sebagai KPI untuk mengukur realisasi lebih awal/terlambat.

---

# 10. Cash Bank Transaction

Cash Bank Transaction adalah actual execution object.

Satu transaction dapat merealisasikan banyak Budget:

```text
Cash Bank Transaction
  ├── Budget A
  ├── Budget B
  └── Budget C
```

Satu Budget juga dapat direalisasikan oleh banyak transaction.

Allocation menjadi dasar realization Budget.

---

# 11. True Multi-Book Model

## 11.1 Book adalah historical store sendiri

Secara konseptual:

```text
journal_line
cash_bank_book
prive_ledger
titipan_ledger
hutang_ledger
piutang_ledger
```

adalah tabel/record store berbeda.

Mereka dapat mempunyai source transaction reference untuk traceability, tetapi operational books **tidak menyimpan Journal reference sebagai sumber history**.

## 11.2 General Ledger

Subjek utama:

> **COA**

Filter utama:

> **COA**

General Ledger menggunakan base currency.

```text
Journal Lines
   ↓
General Ledger by COA
```

## 11.3 Hutang Ledger

Subjek utama:

> **Partner**

Contoh:

```text
Hutang Ledger
  ├── Cabang A
  └── Cabang B
```

Hutang Ledger mempunyai record history sendiri.

Tidak membaca Journal.

## 11.4 Piutang Ledger

Subjek utama:

> **Partner**

```text
Piutang Ledger
  ├── Cabang A
  └── Cabang B
```

Piutang Ledger mempunyai record history sendiri.

Tidak membaca Journal.

## 11.5 Titipan Ledger

Subjek utama:

> **Partner**

```text
Titipan Ledger
  ├── Titipan A
  └── Titipan B
```

Titipan Ledger mempunyai record history sendiri.

Tidak membaca Journal.

## 11.6 Prive Ledger

Subjek utama:

> **Partner**

```text
Prive Ledger
  ├── Prive A
  └── Prive B
```

Prive Ledger mempunyai record history sendiri.

Tidak membaca Journal.

## 11.7 Cash Bank Book

Subjek utama:

> **Cash Bank**

```text
Cash Bank Book
  ├── Kas
  ├── Bank Mandiri
  └── Bank BCA
```

Cash Bank Book mencatat actual money movement langsung dari Cash Bank Transaction.

Tidak membaca Journal.

---

# 12. Subject Model

General Ledger dan operational books memiliki subject yang berbeda.

| Book | Primary Subject | History Source |
|---|---|---|
| General Ledger | **COA** | Journal Lines |
| Hutang Ledger | **Partner** | Hutang Book |
| Piutang Ledger | **Partner** | Piutang Book |
| Titipan Ledger | **Partner** | Titipan Book |
| Prive Ledger | **Partner** | Prive Book |
| Cash Bank Book | **Cash Bank** | Cash Bank Transaction |

Contoh:

```text
3101 + Prive A
```

dan:

```text
3101 + Prive B
```

adalah subject book berbeda.

Begitu juga:

```text
2101 + Cabang A
2101 + Cabang B
```

---

# 13. Posting Multi-Book

Contoh:

```text
Cash Bank Out
Purpose  = Pengeluaran Prive
Partner  = Prive A
Cash Bank = Bank Mandiri
Amount   = 2.500.000
```

Saat Post:

## 13.1 Cash Bank Book

```text
Bank Mandiri
OUT 2.500.000
```

Record dibuat langsung dari Cash Bank Transaction.

## 13.2 Prive Ledger

```text
Prive A
OUT 2.500.000
```

Record dibuat langsung dari business transaction.

## 13.3 Journal

```text
Dr Prive        2.500.000
Cr Bank         2.500.000
```

## 13.4 General Ledger

Journal Lines membentuk historical account movement:

```text
3101 Prive
1102 Bank Mandiri
```

Sehingga:

```text
                 POST
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
   Cash Book   Prive Book  Journal
                             │
                             ▼
                             GL
```

Tidak ada operational book yang membaca Journal.

---

# 14. Journal Line ≠ Operational Ledger

Journal Line menyimpan accounting entry:

```text
Account
Debit
Credit
BP
```

Operational ledger menyimpan business-subject history:

```text
Date
Partner
Direction
Amount
Currency
Exchange Rate
Base Amount
Source Transaction
```

Keduanya merupakan data yang berbeda.

Journal bukan “database induk” bagi operational books.

---

# 15. Append-Only Historical Transaction

Semua operational book bersifat append-only.

Setelah Posted:

```text
new historical record
```

Tidak ada edit/delete terhadap historical row.

Jika koreksi dibutuhkan di masa depan, koreksi harus direpresentasikan sebagai business transaction baru sesuai workflow koreksi/reversal yang akan ditentukan.

Tujuannya:

> user dapat melihat perjalanan transaksi secara historis tanpa history lama berubah.

---

# 16. Currency Model

General Ledger:

```text
Base Currency = IDR
```

Operational books dapat menyimpan:

```text
Transaction Currency
Transaction Amount
Exchange Rate
Base Currency
Base Amount
```

Contoh future:

```text
Cash Bank Book
Currency = USD
Amount   = 1,000
Rate     = 16,000
Base     = IDR
Base Amt = 16,000,000
```

GL:

```text
Base Currency = IDR
Amount        = 16,000,000
```

Foreign currency adalah scope berikutnya, tetapi model data sudah disiapkan untuk mempertahankan original transaction currency.

---

# 17. Reconciliation

Multi-book bukan berarti buku-buku tersebut tidak berhubungan.

Hubungannya adalah **reconciliation**, bukan source dependency.

```text
Operational Book ─────┐
                      ├── Reconciliation
General Ledger ───────┘
```

Contoh:

```text
Prive A Book
Base Net = 10.000.000

GL
COA 3101 + Prive A
Base Net = 10.000.000

Result = MATCH
```

Jika berbeda:

```text
Prive A Book = 10.000.000
GL           = 12.000.000

Result = UNMATCH
```

Perbandingan dilakukan dalam Base Currency.

---

# 18. Traceability

Independent bukan berarti tidak dapat ditelusuri.

Operational book dapat menunjuk ke:

```text
Source Cash Bank Transaction
```

Dari source transaction user dapat melihat Journal.

Tetapi:

```text
Operational Book
      ↓
Source Transaction
      ↓
Journal
```

adalah **traceability**, bukan dependency untuk membentuk history operational book.

---

# 19. End-to-End Example

Kasus:

> Pembayaran Titipan A sebesar Rp4.000.000 dari Bank Mandiri.

### Planning

```text
Budget
Company = Company A
Type    = Pengeluaran
Category = Titipan
Partner = Titipan A
Amount  = 4.000.000
Status  = Open
```

### Execution

```text
Cash Bank Out
Company   = Company A
Cash Bank = Bank Mandiri
Purpose   = Pengeluaran Titipan
Partner   = Titipan A
```

### Post

System menulis:

```text
Cash Bank Book
  Bank Mandiri OUT 4.000.000

Titipan Ledger
  Titipan A OUT 4.000.000

Journal
  Dr Titipan 4.000.000
  Cr Bank    4.000.000

General Ledger
  COA 2102
  COA 1102
```

Semua adalah historical records masing-masing.

---

# 20. Reset Simulation

Reset Simulation menghapus transactional state:

- Budget Month;
- Budget;
- Cash Bank Transaction;
- Journal;
- General Ledger;
- Cash Bank Book;
- Prive Ledger;
- Titipan Ledger;
- Hutang Ledger;
- Piutang Ledger.

Master data tetap dipertahankan:

- Company;
- Currency;
- Cash Bank master;
- Partner;
- Partner Category;
- COA;
- BP configuration;
- Fiscal Period/control master yang bukan transaction history.

Tujuan:

> kembali ke clean base state agar simulasi dapat dijalankan dari awal.

---

# 21. Menu Inventory

## Master

- Company
- Currency
- Cash Bank
- Partner
- Partner Category

## Budget

- Budget Month
- Budget

## Finance

- Cash Bank In
- Cash Bank Out

## Accounting

- Fiscal Period
- Chart of Accounts
- BP / Subledger
- Opening Balance
- Journal
- Ledger
  - General Ledger
  - Prive Ledger
  - Titipan Ledger
  - Hutang Ledger
  - Piutang Ledger
- Account Balance
- Reporting / Financial Statements

---

# 22. Responsibility per Layer

| Layer | Tanggung jawab |
|---|---|
| Master | Reference, entity, resource, currency, subject |
| Fiscal Period | Period control |
| COA | Accounting account structure |
| BP Config | Subject/BP configuration |
| Budget Month | Planning container |
| Budget | Planning object |
| Category | Business classification |
| Purpose | Business event, eligibility, ledger/accounting behavior |
| Cash Bank In/Out | Actual execution |
| Cash Bank Book | Cash/bank historical movement |
| Prive Ledger | Prive subject history |
| Titipan Ledger | Titipan subject history |
| Hutang Ledger | Hutang subject history |
| Piutang Ledger | Piutang subject history |
| Journal | Automatic accounting entry |
| General Ledger | Account history by COA |
| Reconciliation | Compare independent books with GL |

---

# 23. Coherence Test

Setiap actual transaction harus dapat dijelaskan dari beberapa perspektif:

### Planning

```text
Mengapa transaksi terjadi?
→ Budget
```

### Execution

```text
Bagaimana actual movement terjadi?
→ Cash Bank In/Out
```

### Cash history

```text
Kas/Bank mana yang bergerak?
→ Cash Bank Book
```

### Subject history

```text
Partner mana yang bergerak?
→ Prive/Titipan/Hutang/Piutang Ledger
```

### Accounting

```text
Bagaimana transaksi dicatat?
→ Journal
```

### Account history

```text
Bagaimana COA berubah?
→ General Ledger
```

### Control

```text
Apakah buku operasional dan GL konsisten?
→ Reconciliation
```

---

# 24. Final Core Concept

SIBA 3.0 bukan sekadar:

```text
Budget → Finance → Journal
```

tetapi:

```text
                         BUSINESS EVENT
                               │
                 ┌─────────────┼─────────────┐
                 ▼             ▼             ▼
           Cash Bank Book  Subject Book    Journal
                              │              │
                       ┌──────┼──────┐       ▼
                       ▼      ▼      ▼   General Ledger
                     Prive Titipan Hutang/
                                   Piutang
```

**General Ledger adalah accounting book berbasis COA dan berasal dari Journal Lines.**

**Cash Bank Book dan subject books adalah independent historical books dengan subject masing-masing.**

Mereka berjalan **paralel**, bukan sebagai turunan Journal.

Tujuan akhirnya adalah:

```text
Operational Books
       │
       ▼
  RECONCILIATION
       ▲
       │
General Ledger
```

sehingga SIBA dapat membuktikan bahwa historical operational records dan accounting records **match**.

---

# 25. Company Relationship & Treasury Provider

SIBA 3.0 v3 memperkenalkan hubungan antar-Company untuk kasus ketika satu Company tidak memiliki Cash Bank sendiri dan menggunakan Company lain sebagai treasury provider.

Contoh:

```text
Company A = Parent
Company B = Child

A → memiliki Bank
B → tidak memiliki Bank

Treasury Provider B = A
```

Secara konsep:

> **Company A bertindak sebagai treasury/internal bank bagi Company B.**

Treasury Provider bukan berarti Cash Bank A berpindah ownership kepada B.

```text
Cash Bank A
    Owner = Company A
```

B tetap merupakan accounting entity sendiri.

---

# 26. Self-Funded vs Treasury-Funded Realization

Realization memiliki dua execution behavior berdasarkan Company.

## 26.1 Self-Funded

Untuk Company yang memiliki Cash Bank sendiri:

```text
Budget A
   ↓
Approve
   ↓
Realization A
   ↓
Execute / Post
   ↓
Journal A
```

Tidak ada Funding Request.

## 26.2 Treasury-Funded

Untuk Company yang menggunakan Treasury Provider:

```text
Budget B
   ↓
Approve
   ↓
Realization B
   ↓
Funding Request
   ↓
Treasury Provider A
   ↓
Funding
   ↓
Confirm
   ↓
Atomic Post
   ├── Journal B
   └── Journal A
```

Perbedaan ini adalah **routing execution**, bukan berarti Budget atau Realization menjadi object yang berbeda.

---

# 27. Funding Request

## 27.1 Definisi

**Funding Request adalah dokumen intercompany bridge yang dihasilkan dari Realisasi Company yang membutuhkan treasury provider.**

Funding Request:

- bukan Budget;
- bukan Budget baru untuk Treasury Provider;
- bukan Realisasi Company asal;
- bukan Journal;
- bukan Cash Bank transaction.

Fungsinya:

> Menyampaikan kebutuhan dana actual dari Company B kepada Treasury Provider Company A berdasarkan Realisasi B.

Relationship:

```text
Realization B
      ↓
Funding Request
      ↓
Funding A
```

## 27.2 Funding Request Tidak Membuat Planning Baru

Tidak boleh:

```text
Budget B
   ↓
Budget A - Funding B
```

Karena A tidak sedang membuat planning.

A hanya menyediakan cash untuk memenuhi actual realization B.

---

# 28. Granularity Funding Request

Satu Realisasi B dapat berisi banyak Budget:

```text
Budget B1 = 30m
Budget B2 = 20m
Budget B3 = 50m

        ↓

Realization B-001 = 100m
```

Funding Request dibuat pada level Realisasi:

```text
Funding Request FR-001
Source Company = B
Funding Company = A
Source Realization = B-001
Amount = 100m
```

Sehingga:

```text
Many Budgets
     ↓
One Realization
     ↓
One Funding Request
     ↓
One Funding
```

Dengan asumsi:

> **Tidak ada partial funding.**

Maka:

```text
Funding Request Amount
        =
Funding Amount
        =
Realization Amount
```

A tidak melakukan allocation ulang terhadap Budget-Budget di dalam Realisasi.

Traceability tetap tersedia:

```text
Funding A
   ↓
Funding Request
   ↓
Realization B
   ├── Budget B1
   ├── Budget B2
   └── Budget B3
```

---

# 29. Funding Lifecycle

Karena Company A diasumsikan pasti melakukan funding, action A bersifat **confirmation**, bukan business rejection decision.

Flow:

```text
B
Realization
   ↓
Submitted
   ↓
Funding Required
   ↓
Funding Request = Pending

A
   ↓
View Funding
   ↓
Confirm Funding
   ↓
Atomic Post
```

Tidak ada partial funding.

Tidak diperlukan proses:

```text
A Funding = 70m
Request   = 100m
```

Funding harus full amount.

---

# 30. Atomic Intercompany Posting

Ketika A melakukan Confirm Funding, event tersebut menjadi actual boundary untuk kedua Company.

Satu Funding completion menghasilkan accounting pada dua Company:

```text
Intercompany Event
        │
        ├───────────────┐
        ▼               ▼
   Company B        Company A
   Journal B        Journal A
```

Kedua Journal dibuat sebagai bagian dari satu business event.

## Company B

Jika B menggunakan dana A untuk biaya:

```text
Dr Biaya / Asset       70m
Cr Hutang kepada A     70m
```

## Company A

A membayar menggunakan Bank A:

```text
Dr Piutang dari B      70m
Cr Bank A              70m
```

Dengan demikian:

```text
Company B
AP to A = 70m

Company A
AR from B = 70m
```

Kedua balance tersebut dapat direkonsiliasi menggunakan Intercompany Event.

---

# 31. Intercompany Event

Untuk menghubungkan dua accounting entity tanpa menjadikan salah satu Journal sebagai source Journal lainnya, digunakan konsep **Intercompany Event**.

Contoh:

```text
ICE-00001
```

Mempunyai:

```text
ICE-00001
│
├── Funding Request FR-001
├── Funding Transaction A
├── Journal A
└── Journal B
```

Intercompany Event adalah traceability/control identifier.

Ia tidak mengubah prinsip independent historical books.

```text
Journal A ≠ Journal B
```

dan:

```text
Journal A
tidak menjadi source
Journal B
```

Keduanya merupakan accounting representation dari business event yang sama pada Company masing-masing.

---

# 32. Menu Finance

## Company A

```text
Finance
├── Realization
└── Funding
```

### Realization

Untuk kebutuhan yang memang menjadi tanggung jawab A sendiri:

```text
Budget A
   ↓
Realization A
   ↓
Cash Bank A
```

### Funding

Untuk memenuhi Funding Request dari Company B:

```text
Funding Request
   ↓
Review
   ↓
Confirm Funding
   ↓
Bank A movement
   ↓
Journal A + Journal B
```

A tidak memilih Budget B dan tidak membuat Realisasi B.

---

## Company B

```text
Finance
└── Realization
```

B melakukan:

```text
Budget B
   ↓
Realization B
   ↓
Funding Request
```

B tidak memilih Cash Bank karena B tidak memiliki Cash Bank sendiri.

---

# 33. Purpose dan Category pada Intercompany Funding

Category tetap berada pada Budget B dan menjelaskan business classification kebutuhan B.

Contoh:

```text
Budget B
Category = Operasional
Purpose pada Realisasi = Pembayaran Vendor
```

A tidak membutuhkan Category Budget B.

Dari perspektif A, kebutuhan tersebut merupakan:

```text
Treasury / Funding
```

Namun Funding bukan Category Budget A.

Funding adalah **intercompany execution purpose/context**.

Dengan demikian:

```text
B Category
    ↓
Menjelaskan untuk apa B membutuhkan dana

Funding
    ↓
Menjelaskan mengapa A melakukan cash movement
```

---

# 34. End-to-End Example — Pengeluaran Company B

Asumsi:

```text
A
Bank = Bank A

B
Bank = none
Treasury Provider = A
```

B memiliki:

```text
Budget B1 = 30m
Category = Operasional

Budget B2 = 20m
Category = Operasional

Budget B3 = 50m
Category = Operasional
```

Setelah approval:

```text
Budget B1/B2/B3
        ↓
Open
```

B membuat satu Realisasi:

```text
Realization B-001
├── B1 = 30m
├── B2 = 20m
└── B3 = 50m
Total = 100m
```

Karena B menggunakan A sebagai Treasury Provider:

```text
Realization B-001
        ↓
Funding Request FR-001
Amount = 100m
```

A melihat:

```text
Funding
FR-001
From = B
Amount = 100m
Reference = Realization B-001
```

A melakukan:

```text
Confirm Funding
```

Kemudian satu atomic posting menghasilkan:

### Company A

```text
Cash Bank Book
Bank A OUT 100m

Piutang Ledger
B +100m

Journal A
Dr Piutang B     100m
Cr Bank A        100m
```

### Company B

```text
Hutang Ledger
A +100m

Journal B
Dr Biaya / Asset 100m
Cr Hutang A      100m
```

---

# 35. End-to-End Example — Company A Normal Realization

Jika A sendiri melakukan transaksi:

```text
Budget A
   ↓
Approve
   ↓
Realization A
   ↓
Execute / Post
```

Maka:

```text
Funding Request = none
```

Contoh:

```text
Company A
Bank A OUT 20m

Journal A
Dr Expense 20m
Cr Bank    20m
```

Tidak ada Journal B.

---

# 36. Intercompany Settlement

Funding menciptakan outstanding relationship:

```text
A
Piutang B = 100m

B
Hutang A = 100m
```

Ketika B menyerahkan dana kepada A:

```text
B → A
```

maka settlement dapat menghasilkan:

### Company B

```text
Dr Hutang A
Cr Cash / Bank
```

### Company A

```text
Dr Bank
Cr Piutang B
```

Sehingga:

```text
A AR from B = 0
B AP to A    = 0
```

Dengan demikian hubungan treasury B dengan A mempunyai siklus:

```text
B Realization
      ↓
Funding Request
      ↓
A Funding
      ↓
A AR / B AP
      ↓
Settlement
      ↓
AR/AP = 0
```

---

# 37. Incoming Transaction Company B

Model yang sama berlaku ketika B menerima uang tetapi tidak mempunyai Bank.

Misalnya pihak eksternal membayar kewajiban kepada B:

```text
External Party
      ↓
Bank A
      ↓
A menerima cash
```

Secara intercompany:

```text
Company B
Dr Piutang A
Cr Revenue / Liability / relevant account

Company A
Dr Bank A
Cr Hutang kepada B
```

A menjadi treasury holder bagi B.

Detail purpose dan accounting mapping mengikuti business event yang relevan.

---

# 38. Reconciliation Intercompany

Operational books tetap independent.

Namun intercompany event memberikan control relationship:

```text
Company A
Piutang Ledger
      │
      │
      ▼
Intercompany Reconciliation
      ▲
      │
      │
Company B
Hutang Ledger
```

Contoh:

```text
A AR B = 100m
B AP A = 100m

Result = MATCH
```

Jika:

```text
A AR B = 100m
B AP A = 90m

Result = UNMATCH
```

Reconciliation tidak membuat salah satu book membaca book lainnya.

---

# 39. Updated Core Architecture

```text
                         MASTER
                           │
              ┌────────────┴────────────┐
              │                         │
          Company A                 Company B
          Parent                   Child
          Has Bank                 No Bank
              │                         │
              └──── Treasury Provider ─┘
                         │
                         ▼
                       BUDGET
                         │
                    Approval/Open
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        Realization A         Realization B
              │                     │
              │              Funding Request
              │                     │
              │                     ▼
              │                  Funding A
              │                     │
              │                  Confirm
              │                     │
              └──────────┬──────────┘
                         ▼
                       POST
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
         Company A              Company B
         Journal A              Journal B
              │                     │
         GL / Books             GL / Books
              │                     │
              └──────────┬──────────┘
                         ▼
                  Reconciliation
```

---

# 40. Updated Responsibility

| Layer | Responsibility |
|---|---|
| Company | Accounting and ownership entity |
| Treasury Provider | Company yang menyediakan/menampung cash Company lain |
| Budget | Planning |
| Category | Business classification Budget |
| Realization | Actual execution intent dari Company |
| Funding Request | Intercompany bridge dari Realization yang membutuhkan treasury |
| Funding | Treasury execution/confirmation oleh Provider |
| Cash Bank Book | Historical cash movement Company pemilik Bank |
| Hutang Ledger | Subject history kewajiban Company |
| Piutang Ledger | Subject history hak tagih Company |
| Journal | Accounting entry per Company |
| General Ledger | Account history per Company |
| Intercompany Event | Cross-company traceability/control |
| Reconciliation | Memastikan AR/AP intercompany match |

---

# 41. Updated Core Concept

SIBA 3.0 v3 bukan hanya:

```text
Budget → Finance → Journal
```

tetapi:

### Self-funded Company

```text
Budget
  ↓
Realization
  ↓
Execute
  ↓
Journal
```

### Treasury-funded Company

```text
Budget
  ↓
Realization
  ↓
Funding Request
  ↓
Treasury Provider
  ↓
Funding Confirm
  ↓
Atomic Intercompany Posting
  ├── Journal Company B
  └── Journal Company A
```

Prinsip utama:

> **Budget tetap milik Company yang mempunyai kebutuhan. Treasury Provider tidak menerima Budget baru.**

> **Realisasi B tidak dieksekusi oleh A. Realisasi B menghasilkan Funding Request, lalu A memiliki Funding transaction sendiri.**

> **Funding Request adalah bridge, bukan planning object.**

> **A dan B menghasilkan Journal masing-masing sebagai accounting representation dari satu Intercompany Event.**

> **Tidak ada partial funding: satu Realisasi B → satu Funding Request → satu Funding A dengan nominal yang sama.**

> **A hanya perlu mengonfirmasi funding karena secara business rule A pasti menyediakan dana.**

Dengan model ini, Company A benar-benar berfungsi sebagai **internal bank/treasury provider** bagi B tanpa merusak prinsip dasar SIBA bahwa Budget adalah planning, Finance adalah execution, dan setiap Company mempunyai accounting history sendiri.


---

# 42. V3 Change Summary

Perubahan utama dari v2:

1. Menambahkan **Treasury Provider** pada hubungan antar-Company.
2. Menetapkan Company B dapat menggunakan Company A sebagai internal bank/treasury provider.
3. Menambahkan **Funding Request** sebagai dokumen intercompany bridge.
4. Menegaskan Funding Request **bukan Budget baru**.
5. Menegaskan A tidak mengeksekusi Realisasi B secara langsung.
6. A memiliki **Funding transaction** sendiri.
7. Realisasi B yang membutuhkan funding menghasilkan satu Funding Request.
8. Satu Realisasi B dapat terdiri dari banyak Budget.
9. Karena tidak ada partial funding, nominal Realisasi = Funding Request = Funding.
10. Confirm Funding oleh A menjadi trigger atomic posting untuk Journal A dan Journal B.
11. Menambahkan **Intercompany Event** untuk traceability tanpa membuat Journal antar-company saling bergantung.
12. Menambahkan flow settlement AR/AP antar-company.
