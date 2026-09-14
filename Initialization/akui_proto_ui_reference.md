# Referensi UI/UX — Akui Proto (erp.prototype-akui.online)

> **Tujuan dokumen:** merekam pola desain aplikasi pembanding (Akui Proto) sebagai dasar untuk memperbaiki `siba30_master_mockup.html`.
> **Ruang lingkup observasi:** modul **Masters** dan **Accounting** (atas permintaan). Dashboard, Purchasing, Logistics, Settings, Finance hanya dipetakan strukturnya, tidak dianalisis mendalam.
> **Metode:** inspeksi langsung di browser — screenshot, DOM, dan computed style. Semua angka di bawah adalah nilai terukur, bukan perkiraan.
> **Tanggal:** 13 September 2026.

---

## 1. Ringkasan eksekutif

Akui Proto adalah aplikasi Next.js + Tailwind CSS v4 dengan karakter **light, sangat padat (dense), sudut sangat membulat, dan aksen kuning-slate**. Tiga hal yang paling layak diadopsi SIBA:

1. **Filter per kolom langsung di dalam header tabel** — jauh lebih cepat daripada search tunggal.
2. **Tree view untuk COA** sebagai presentasi utama Chart of Accounts, bukan tabel datar.
3. **Balance summary strip** di bawah grid line item jurnal (Seimbang / Belum Seimbang + total debit/kredit live).

Tiga hal yang **tidak** boleh diadopsi:

1. Skala font 12px root (label form hanya 8,4px) — terlalu kecil.
2. Mode "view" yang memakai input ter-disable, bukan penyajian read-only.
3. Audit trail yang diletakkan di tiga tempat berbeda tergantung entitas.

---

## 2. Peta modul & navigasi

### 2.1 Struktur IA

Dua tingkat: **rail ikon** (modul) → **panel submenu** (grup + leaf).

| Modul | Grup | Leaf |
|---|---|---|
| Masters | Warehouses | Warehouse, Location |
| Masters | — | Items, Partners |
| Purchasing | — | Overview |
| Purchasing | Purchase Request | Barang, Jasa, Asset |
| Purchasing | Purchase Order | Barang, Jasa, Asset |
| Logistics | — | Overview, QC Incoming |
| Logistics | GRN | Barang, Jasa |
| Logistics | Adjustment | Qty Adjustment, Value Adjustment |
| Logistics | Stock Transfer | Send, Receive |
| Logistics | Stock Reports | Stock Ledger, Stock Balance, Stock Val Ledger, Stock Val Balance |
| Settings | References | Currencies, Cash & Bank, Tax, Unit of Measure, Item Groups, Payment Terms, Exchange Rate |
| Accounting | Chart of Accounts | Category, Subcategory, Account |
| Accounting | — | Journals |
| Accounting | Period & Balance | Fiscal Period, Opening Balance |
| Finance | Down Payment | AP Cash Advance |

**Catatan pemetaan ke SIBA:** yang mereka sebut *Settings → References* adalah yang di SIBA masuk *Master → Referensi/Klasifikasi*. Struktur COA (Category → Subcategory → Account) identik dengan SIBA. Fiscal Period digabung dengan Fiscal Year dalam satu halaman (master-detail), tidak dipisah dua menu seperti rencana SIBA.

### 2.2 Pola URL (konsisten di seluruh app)

```
/modules/erp/<modul>/<grup>/<entitas>            → list view
/modules/erp/<modul>/<grup>/<entitas>/add        → create
/modules/erp/<modul>/<grup>/<entitas>/update?id=<n>&mode=view   → detail (read-only)
/modules/erp/<modul>/<grup>/<entitas>/update?id=<n>&mode=edit   → edit
```

Satu route `update` melayani view **dan** edit lewat query param `mode`. Ini pola yang bagus dan sudah sejalan dengan pendekatan single-component SIBA (create + view + edit).

### 2.3 Shell layout

```
┌──────────────────────────────────────────────────────────┐
│ header  fixed  h-16 (48px)  bg-white/95 backdrop-blur-md │ ← logo kiri, user chip kanan
├──┬───────────┬───────────────────────────────────────────┤
│▓▓│  panel    │  main                                     │
│▓▓│  submenu  │  p-3 / sm:p-4 / lg:p-6                    │
│▓▓│  (float)  │  space-y-6                                │
└──┴───────────┴───────────────────────────────────────────┘
   ↑ rail ikon floating
```

- **Rail:** `fixed left-3 top-[76px] bottom-3`, lebar `w-16` (48px), `bg-#1d2633`, `rounded-2xl`, `shadow-xl`. **Melayang**, bukan menempel ke tepi layar. Terdiri dari dua kartu terpisah: kartu atas (Home Portal, Semua Modules) dan kartu bawah (7 modul, scrollable).
- **Item rail:** `w-10 h-10` (30×30px) `rounded-xl`. Idle `bg-white/5 text-slate-300`; aktif `bg-brand-yellow text-brand-blue shadow-lg shadow-brand-yellow/30 ring-2 ring-brand-yellow/50`.
- **Tooltip rail:** muncul saat hover di kanan ikon — kotak `bg-slate-900 text-white text-xs font-bold px-3 py-1.5 rounded-md` dengan segitiga penunjuk CSS (`border-r-[7px] border-r-slate-900`).
- **Panel submenu:** `ml-3 w-60 min-w-[220px] max-w-[250px] h-full bg-white border border-slate-200/80 rounded-2xl shadow-xl p-4`. Juga melayang, dengan tombol collapse (chevron bulat `w-7 h-7` di kanan judul).
- **Grup submenu** = tombol accordion `w-full flex justify-between px-3.5 py-2.5 rounded-xl font-bold`; aktif berwarna gelap `bg-brand-blue text-white` dengan dot kuning kecil di kiri.
- **Leaf submenu** = anchor `px-3 py-2 rounded-xl text-slate-600`; aktif `bg-slate-100`.
- **Top bar sangat minim:** hanya logo + chip user. **Tidak ada** global search, notifikasi, atau company/context switcher.
- **FAB "Buka Asisten AI"** di `fixed right-6 bottom-6`, lingkaran gelap dengan badge kuning.

---

## 3. Design tokens

### 3.1 Root scale — hal terpenting untuk dipahami

```css
html { font-size: 12px }   /* bukan 16px */
```

Seluruh skala rem Tailwind terpotong **×0,75**. Konsekuensinya:

| Kelas Tailwind | Nominal | Render nyata |
|---|---|---|
| `text-[10px]` | 10px | 10px |
| `text-xs` (0.75rem) | 12px | **9px** |
| `text-[0.85rem]` | 13.6px | **10,2px** |
| `text-sm` (0.875rem) | 14px | **10,5px** |
| `text-[0.7rem]` (label form) | 11,2px | **8,4px** |
| `text-2xl` (judul halaman) | 24px | **18px** |
| `p-4` / `p-6` | 16 / 24px | **12 / 18px** |
| `rounded-xl` / `2xl` / `3xl` | 12 / 16 / 24px | **9 / 12 / 18px** |
| `gap-2.5` | 10px | **7,5px** |

> **Rekomendasi:** ambil *proporsi* dan *ritme* mereka, jangan skala absolutnya. Label form 8,4px berada di bawah ambang keterbacaan yang wajar untuk aplikasi akuntansi yang dipakai seharian.

### 3.2 Warna (nilai terukur)

| Peran | Nilai | Catatan |
|---|---|---|
| Background app | `#F4F6F8` | |
| Surface / card | `#FFFFFF` | |
| Border card | `slate-200/90` | hairline 1px |
| Teks utama (`brand-blue`) | `#3E495A` | slate-blue, bukan biru terang |
| Teks sekunder | `slate-500` `#64748B` | |
| Teks header tabel | `slate-400` `#94A3B8` | |
| Aksen (`brand-yellow`) | `#DBC360` | dipakai untuk state aktif & tombol filter |
| Tombol filter apply | `#D9B84C` | hover `#CBAA3E`, active `#BD9C32` |
| Tombol reset | `#E2E8F0` | |
| Rail gelap | `#1D2633` | |
| Sukses / AKTIF / OPEN / POSTED | emerald | badge solid |
| Bahaya / NON AKTIF | rose-red | badge solid |
| Peringatan / Unbalanced | amber | |

**Catatan:** ada set CSS variable dark theme lengkap di `:root` (`--bg-app:#090d16`, `--accent-supabase:#3ecf8e`, dst.) yang **tidak dipakai sama sekali** — sisa boilerplate. Abaikan.

### 3.3 Radius, shadow, font

- Radius: input & tombol `rounded-xl` (9px) · kartu `rounded-2xl` (12px) · modal `rounded-3xl` (18px) · badge `rounded-md` (4,5px).
- Shadow: kartu `shadow-sm shadow-slate-200/30` · tombol primer `shadow-lg shadow-brand-blue/20` · overlay `shadow-2xl` · elemen kecil `shadow-2xs`.
- Font: **Plus Jakarta Sans** (UI) + **JetBrains Mono** (kode, ID, angka).
- Font-weight dipakai sangat berat: `font-bold` (700) untuk hampir semua label & tombol, `font-black` (900) untuk judul halaman, `font-extrabold` (800) untuk label field.

---

## 4. List view

### 4.1 Anatomi halaman

```
┌ page header ────────────────────────────────────────────┐
│ [ENTERPRISE RESOURCE PLANNING] / ACCOUNTING              │  ← breadcrumb
│ 📖 Chart of Accounts Category            [+ Tambah ...] │  ← h1 + primary action
│ Kelola kategori bagan akun ...                           │  ← subtitle
└──────────────────────────────────────────────────────────┘
┌ card (rounded-2xl, p-4/p-6) ────────────────────────────┐
│                              [⧩ Filter]  [SHOW 10 ⌄]    │  ← toolbar kanan
│  (opsional) FILTER FORM panel                            │
│ ┌──────────────────────────────────────────────────┐    │
│ │ NO  KODE ⇅   NAMA ⇅   STATUS ⇅   AKSI            │    │  ← header uppercase 10px
│ │ FILTER [🔍..] [🔍..]  [🔍..]                      │    │  ← baris filter per kolom
│ │ 1   CAT00001  Aktiva   [AKTIF]   👁 ✏️            │    │
│ └──────────────────────────────────────────────────┘    │
│ PAGE 1 OF 1 (2 TOTAL)          « ‹ [1] › »              │
└──────────────────────────────────────────────────────────┘
```

### 4.2 Spesifikasi tabel

| Elemen | Spesifikasi |
|---|---|
| Wrapper | `div.relative.overflow-x-auto.w-full` |
| Table | `w-full text-left border-collapse min-w-full` |
| `thead` | **2 baris** — baris 1 label, baris 2 filter (`bg-slate-50/40 border-b border-slate-100`) |
| `th` | `px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 whitespace-nowrap` — terukur: 10px / 700 / letter-spacing 1px / padding 9px 12px, background transparan |
| `td` | `px-4 py-2.5` → padding 7,5px 12px |
| Tinggi baris | **38px** |
| Hover baris | `hover:bg-slate-100/90`, `group/row` untuk mewarnai sel anak |
| Sort | ikon `⇅` di sebelah label, per kolom |
| Kolom AKSI | ikon saja: 👁 View Details, ✏️ Edit. **Tidak ada tombol hapus.** |

### 4.3 Baris filter per kolom (pola paling layak dicontek)

Baris kedua `thead` berisi satu input pencarian mungil per kolom, dengan ikon kaca pembesar dan placeholder `Filter <Nama Kolom>...`. Label baris di kolom pertama tertulis `FILTER`. Filter bersifat *live*. Ini menghilangkan kebutuhan berpikir "search ini mencari di kolom mana".

### 4.4 Panel "Filter Form" (redundan — lihat §9)

Tombol `Filter` di toolbar membuka panel di dalam kartu (bukan modal/drawer):

- Judul `FILTER FORM` + ikon corong, tombol `×` di kanan.
- Grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-y-3 gap-x-4`.
- Label field di sini **sentence case** ("Tipe Akun") — beda dengan header tabel yang uppercase.
- Aksi kanan-bawah: `Filter` (kuning `#d9b84c`) + `Reset` (abu `#e2e8f0`), keduanya `px-4 py-1.5 rounded-xl font-bold text-xs`.

### 4.5 Pagination

- Kiri: `PAGE 1 OF 1 (2 TOTAL)` — uppercase, warna muted.
- Kanan: `«` `‹` `[1]` `›` `»`. Halaman aktif = kotak kuning `bg-brand-yellow`.
- Page-size: tombol `SHOW 10 ⌄` (`bg-white px-3 py-1.5 rounded-xl border border-slate-200/90 shadow-2xs`), bukan `<select>` native.

### 4.6 Presentasi sel

| Pola | Contoh | Implementasi |
|---|---|---|
| **Sel dua baris (FK)** | `Aktiva Lancar` (bold) di atas `Aktiva Lancar` (mono, abu) | nama tampil + kode/label teknis di bawahnya |
| **Code chip** | `CAT00001`, `FY00002`, `ITM00006` | `font-mono text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md tracking-wider` |
| **Status badge** | `AKTIF` / `NON AKTIF` / `OPEN` / `DRAFT` / `POSTED` | solid fill + border sewarna + teks putih |
| **Badge properti jamak** | `BELI` `JUAL` `STOK` `EXPIRABLE` `PRODUKSI` | wrap ke beberapa baris, tinggi baris menyesuaikan |
| **Sub-badge di bawah nama** | `Cup Mangkok` + `VARIANT` | menandai atribut turunan |
| **Tanggal & angka** | `2026-01-01`, `Rp 17.800` | selalu monospace |

Badge base: `inline-flex items-center gap-1 font-bold rounded-md tracking-wider uppercase px-2 py-0.5 text-[10px]`.

---

## 5. Tree view — Chart of Accounts

Halaman `chart-of-accounts/account` **tidak** memakai tabel. Ini presentasi paling menarik di aplikasi ini.

```
[Buka Semua] [Tutup Semua]                        [+ Tambah Akun]
┌ kartu search ───────────────────────────────────────────────┐
│ 🔍 Cari kode akun, nama kategori, subkategori, atau nama...  │
└──────────────────────────────────────────────────────────────┘
┌ kartu tree ─────────────────────────────────────────────────┐
│ ⌄ [CATEGORY] [CAT00001] – Aktiva            3 Subkategori ⓘ │
│   ⌄ [SUBCAT] [SUB00001] – Bank BNI               3 Akun  ⓘ  │
│     · [ACC00001] – BNI Akui Jombang   ▪ [DEBIT] ⚠  👁 ✏️ ⓘ  │
│     · [ACC00002] – Bank Jago Virtual  ▫ [DEBIT]    👁 ✏️ ⓘ  │
│   · [SUBCAT] [SUB00002] – Bank BCA          [NON AKTIF]  ⓘ  │
└──────────────────────────────────────────────────────────────┘
```

**Anatomi node** (`group flex items-center justify-between py-2 px-3 rounded-xl border border-transparent hover:bg-slate-100/80 hover:border-slate-200/60 text-xs cursor-pointer`):

- Kiri: slot chevron/dot `w-5 h-5` (dot `w-1.5 h-1.5 rounded-full bg-slate-300` untuk leaf) → type chip (`CATEGORY` gelap / `SUBCAT` kuning) → code chip mono → separator `–` → nama (`truncate font-semibold text-slate-800`).
- Kanan: badge properti (normal balance `DEBIT`/`KREDIT`, indikator postable/control/require-partner sebagai kotak ikon `w-5 h-5 rounded-md` berwarna dengan tooltip) → ikon aksi (View Details, Edit, Lihat Detail B-Tree).
- Node induk menampilkan **hitungan anak** di kanan (`3 Subkategori`, `3 Akun`).
- Node non-aktif ditampilkan miring/pudar + badge `NON AKTIF`.
- Indentasi lewat garis vertikal tipis di kiri.

Search bar di kartu terpisah di atas tree, lebar penuh, mencari di semua level sekaligus.

---

## 6. Form view

### 6.1 Header halaman form

```
[←] [ENTERPRISE RESOURCE PLANNING] / ACCOUNTING / CHART OF ACCOUNTS
    ⚖ Detail Akun Bagan / ACC00001 [AKTIF]      [🕘 Riwayat Perubahan 1]
```

- Tombol back = lingkaran putih berbingkai di kiri breadcrumb.
- Judul + kode (mono) + status badge dalam satu baris.
- Aksi utama di **kanan atas halaman**, bukan di footer. Tidak ada sticky action bar.
  - Create: `Simpan` / `Simpan Draft` (biru solid).
  - View (Account): `Riwayat Perubahan <n>`.
  - View (Item): `Kembali` (outline) — **tidak konsisten**, lihat §9.

### 6.2 Layout field

- Kartu `rounded-2xl bg-white border border-slate-200/90 p-4 sm:p-6`.
- Grid kolom **menyesuaikan entitas**: Account 2 kolom, Item 3 kolom, Fiscal Year 4 kolom. Field panjang (Catatan, Nama Item Lengkap) span penuh.
- Section di dalam kartu dipisah heading uppercase kecil: `KONFIGURASI TRANSAKSI & KONTROL AKUN`, `KONFIGURASI KARAKTERISTIK & PERLAKUAN ITEM`, `FOTO PRODUK / ITEM`.
- Untuk dokumen transaksi, section dipecah jadi **kartu terpisah** dengan ikon + judul + subtitle:
  `📖 Informasi Utama Jurnal (Header)` / `📚 Rincian Ayat Jurnal (Journal Lines)` + *"Entri pos akun pembukuan, debit, kredit, dan kontak partner"*.

### 6.3 Anatomi field

| Elemen | Kelas / nilai |
|---|---|
| Label | `text-[0.7rem] font-extrabold text-slate-500 uppercase tracking-widest px-1` → 8,4px / 800 / ls 0,84px |
| Wajib | asterisk `*` merah setelah label |
| Input | `w-full px-4 py-2.5 rounded-xl border text-[0.85rem] font-medium text-slate-800 placeholder:text-slate-300` → tinggi **32px**, radius 9px |
| Ikon dalam field | ada, di kiri; input diberi `pl-10` |
| Disabled / view | `bg-slate-100/80 border-slate-200 text-slate-500 cursor-not-allowed shadow-2xs select-none` |
| Focus | border `brand-yellow` |
| Textarea | sama, `resize` aktif, tinggi ±80px |
| Checkbox | grid 3–4 kolom, label di kanan, sentence case |

### 6.4 Combobox / FK picker (bagus, layak dicontek)

Klik field → panel **di-portal ke `<body>`**: `bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden`.

- Sub-header pencarian: `p-2 border-b border-slate-50` berisi input `bg-slate-50 rounded-lg text-xs font-semibold` dengan placeholder `Filter options...`.
- Opsi dirender sebagai **code chip + `–` + nama**, konsisten dengan tampilan tabel dan tree.
- **Hanya record aktif yang muncul** — Bank BCA (NON AKTIF) tidak tampil di daftar pilihan subkategori. Ini perilaku yang benar dan harus ditiru SIBA.
- Field yang sudah terisi punya tombol `×` (clear) + chevron.
- Kelemahan: `Esc` tidak menutup dropdown.

### 6.5 Grid line item (Journals)

- Header kolom: `# | Akun Perkiraan (COA)* | Partner/Kontak | Mata Uang* | Kurs* | Trx Amount* | Debit (IDR)* | Kredit (IDR)* | Catatan/Memo`.
- Setiap sel adalah kontrol (combobox atau input angka) berbingkai, bukan teks polos — tampilannya seragam dengan field form.
- Sel FK menampilkan dua baris: nama (bold) + kode mono di bawah.
- Placeholder informatif untuk sel opsional: `Tidak Perlu Partner`.
- Grid scroll horizontal dengan scrollbar tipis.
- Kosong → teks tengah `Belum ada baris transaksi jurnal.` + tombol `+ Tambah Transaksi Baris Baru` (outline, kiri).

### 6.6 Balance summary strip (sangat relevan untuk SIBA)

Tepat di bawah grid, masih di dalam kartu yang sama, strip berlatar tipis:

```
┌────────────────────────────────────────────────────────────────┐
│ ⚖  Status Keseimbangan (Debit – Kredit):  ✓ Seimbang (Balanced)│
│    Selisih Debit dikurangi Kredit: Rp 0                        │
│                          TOTAL DEBIT      TOTAL KREDIT         │
│                          Rp 17.800        Rp 17.800            │
└────────────────────────────────────────────────────────────────┘
```

- Seimbang → hijau + ikon centang. Tidak seimbang → amber + ikon peringatan, teks `⚠ Belum Seimbang (Unbalanced)`.
- Total selalu monospace, uppercase label kecil di atasnya.
- Live, dihitung ulang saat baris berubah.

### 6.7 Master-detail: Fiscal Year & Period

Satu halaman menampung dua level:

1. Kartu `Informasi Tahun Fiskal` — 4 kolom (Tahun Fiskal, Label Tahun, Tanggal Awal, Tanggal Akhir) + Catatan span penuh.
2. Kartu `Rincian Periode Fiskal (12 Bulan)` — tabel anak dengan kolom `AKSI (GEMBOK)`, ditambah **hint text rata kanan** di header section: *"Klik ikon gembok untuk mengunci / membuka masing-masing bulan periode."*

Lock/unlock per bulan dilakukan langsung dari baris tabel, bukan dari form terpisah.

### 6.8 Tab untuk koleksi anak (Master Item)

Di bawah kartu form utama, tab bar `flex border-b border-slate-200 gap-2 overflow-x-auto`:

```
[📚 Varian Item (2)] [⚖ Konversi Satuan (UoM) (1)] [🛒 Setup Pembelian / Vendor (0)] [🕘 Audit Log]
```

- Tab aktif: `border-b-2 border-brand-blue text-brand-blue font-bold`.
- Tab non-aktif: `border-transparent text-slate-500 hover:text-slate-800`.
- **Hitungan record ada di label tab** — pengguna tahu isi tab tanpa membukanya.
- Isi tab = kartu berjudul (`Daftar Spesifikasi & Varian Item`) berisi tabel sederhana.

### 6.9 Halaman scoped (Opening Balance)

Kartu konteks di paling atas sebelum kartu data:

```
┌──────────────────────────────────────────────────────────────┐
│ PILIH TAHUN FISKAL *          │ STATUS TAHUN FISKAL │ PERIODE AKTIF        │
│ [📅 TAHUN FISKAL 2 – 2027 ×⌄] │ [OPEN]              │ 2027-01-01 s/d 12-31 │
└──────────────────────────────────────────────────────────────┘
```

Satu kontrol editable (pemilih scope) + beberapa nilai turunan read-only sebagai chip. Pola ini pas untuk halaman SIBA yang bergantung fiscal period / company.

---

## 7. Modal, drawer, overlay

### 7.1 Confirm modal (dialog satu-satunya yang ditemukan)

```
        ┌──────────────────────────┐
        │        ⚠ (bulat rose)     │
        │  Konfirmasi Nonaktifkan   │
        │          Data             │
        │ [ITM00004 – Cup Mangkok]  │
        │ Apakah Anda yakin ingin   │
        │ menonaktifkan data ini?   │
        │ Data yang nonaktif tidak  │
        │ akan muncul pada pilihan  │
        │ transaksi/operasional...  │
        │ [ Batal ] [Ya, Nonaktifkan]│
        └──────────────────────────┘
```

| Properti | Nilai |
|---|---|
| Container | `fixed inset-0 z-[9999] flex items-center justify-center p-4` |
| Scrim | `bg-slate-900/60 backdrop-blur-sm` (blur 8px) |
| Panel | `bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-slate-100 space-y-5 text-center` — lebar terukur **288px** |
| Ikon | lingkaran tinted (rose-50) berisi ikon peringatan, di tengah atas |
| Subjek | chip abu berisi `<KODE> – <Nama>` — pengguna melihat persis apa yang diubah |
| Body | menjelaskan **konsekuensi**, bukan sekadar "yakin?" |
| Tombol | dua, lebar sama, sejajar: `Batal` (abu) + `Ya, Nonaktifkan` (merah solid) |

Semua rata tengah (`text-center`), berbeda dari pola dialog kiri-ikon/kanan-tombol.

### 7.2 Drawer riwayat perubahan

- Container `fixed inset-0 z-[100] flex justify-end`; scrim `bg-slate-900/40 backdrop-blur-sm`.
- Panel `relative w-full max-w-lg bg-white h-full shadow-2xl border-l border-slate-200 z-[101] flex flex-col` — lebar terukur **384px**.
- Header: ikon tile + judul `Riwayat Perubahan` + subtitle `Log aktivitas Akun Bagan`.
- Body `flex-1 overflow-y-auto p-6 space-y-4`.
- Tiap entri: avatar bulat → email + timestamp (`19 Agu 2026 • 13:21`) → nama tabel teknis (`acc_account`) + action badge (`TAMBAH` hijau / `UPDATE` kuning / `HAPUS` merah) → daftar `field: value`.

### 7.3 Riwayat inline (Journals) & tab (Item)

Entitas jurnal menampilkan riwayat sebagai **section di dasar halaman** dengan tombol `Collapse All` dan per-entri `Sembunyikan`. Diff level field ditampilkan sebagai `Status Jurnal: Draft → Posted` (nilai lama diwarnai muted). Master Item menampilkannya sebagai **tab** `Audit Log`.

→ Tiga penempatan berbeda untuk fungsi yang sama. Lihat §9.

### 7.4 Yang tidak ditemukan

Tidak ada toast/snackbar, tidak ada skeleton loader (hanya fade-in opacity saat mount), tidak ada command palette, tidak ada shortcut keyboard.

---

## 8. State & pola presentasi lain

| State | Perlakuan |
|---|---|
| **Empty (bisa diisi user)** | teks tengah `Belum ada baris transaksi jurnal.` + tombol tambah |
| **Empty (diisi proses lain)** | dua baris: `Belum ada data saldo awal (Opening Balance) yang tercatat untuk tahun fiskal ini.` + baris kecil `Data opening balance dibuat melalui proses migrasi awal atau penutupan buku tahun fiskal sebelumnya.` — **tanpa CTA**, karena user memang tidak bisa membuatnya di sini |
| **Empty (lampiran)** | kartu inline berbingkai: ikon gambar + `Belum ada foto item yang diunggah.` |
| **Counter** | teks kecil rata kanan di header section: `Total 0 baris akun terdaftar` |
| **Loading** | animasi opacity/translate saat mount; tidak ada skeleton |
| **Soft delete** | tidak ada aksi hapus di list; status badge dapat diklik (`title="Klik untuk mengubah status"`) → confirm modal → aktif/non-aktif |
| **Validasi** | hanya `required` HTML native; **tidak ada pesan error inline** saat submit kosong |

---

## 9. Inkonsistensi & hal yang jangan ditiru

1. **Skala terlalu kecil.** Root 12px, label form 8,4px, teks tabel 9–10px. Untuk aplikasi akuntansi yang dipakai berjam-jam ini melelahkan.
2. **View mode = input ter-disable.** Semua field detail digambar sebagai input abu yang tidak bisa diklik. Ini menyampaikan "rusak/terkunci", bukan "read-only". Nilai read-only sebaiknya disajikan sebagai teks.
3. **Audit trail di tiga tempat** (drawer / section inline / tab) tergantung entitas.
4. **Aksi header form tidak konsisten:** Account view → `Riwayat Perubahan`; Item view → `Kembali`; keduanya sudah punya tombol back di kiri.
5. **Tidak ada validasi inline.** Klik `Simpan` dengan form kosong tidak menghasilkan feedback yang terlihat.
6. **Filter ganda yang redundan:** baris filter per kolom **dan** panel Filter Form berisi field yang sama persis.
7. **Casing label tidak konsisten:** header tabel uppercase, label Filter Form sentence case, label form uppercase.
8. **Dua opasitas scrim:** modal 60%, drawer 40%.
9. **Terlalu banyak badge solid jenuh** di kolom `PROPERTI ITEM` (5 chip penuh warna dalam satu sel) — mata tidak punya tempat istirahat.
10. **Nol dukungan keyboard.** `Esc` tidak menutup dropdown maupun drawer; tidak ada shortcut.
11. **Panel submenu melayang di atas konten** dan menutup sendiri tanpa aba-aba saat berpindah halaman.
12. **Top bar kosong** — tidak ada company switcher, padahal SIBA multi-company.

---

## 10. Gap analysis terhadap `siba30_master_mockup.html`

### 10.1 Perbandingan token

| Aspek | SIBA saat ini | Akui Proto | Putusan |
|---|---|---|---|
| Base font | 13,5px | 12px root (efektif 9–10,5px) | **Pertahankan SIBA** |
| Font family | system-ui stack | Plus Jakarta Sans + JetBrains Mono | **Adopsi sebagian** — tambahkan font mono yang lebih tegas; UI font boleh tetap system stack |
| Primary | `#2C7BE5` biru terang | `#3E495A` slate-blue + aksen kuning `#DBC360` | **Pertahankan SIBA** (biru lebih netral untuk ERP), tapi turunkan saturasi warna aksen di rail |
| Radius | 5 / 7 / 10px | 9 / 12 / 18px | **Naikkan sedikit** → 6 / 9 / 12px. Radius SIBA saat ini terasa kaku |
| Card padding | 16px | 12–18px | Setara, pertahankan |
| Tinggi baris tabel | ~35px (9px pad + 13px font) | 38px | Setara, pertahankan |
| Chip/badge | pill pastel + dot, border sewarna | solid jenuh, teks putih, `rounded-md` | **Pertahankan SIBA** — lebih terbaca saat banyak chip |
| Shadow | halus (`0 1px 2px`) | lebih dalam (`shadow-lg`, `shadow-2xl`) | **Adopsi sebagian** untuk overlay saja |

### 10.2 Perbandingan pola

| Pola | SIBA saat ini | Akui Proto | Putusan |
|---|---|---|---|
| Rail modul | docked 212px berlabel teks | floating 48px ikon + tooltip | **Pertahankan SIBA** — label teks lebih jelas untuk 6+ modul |
| Sub sidebar | docked 238px | floating 220px, bisa collapse | **Adopsi tombol collapse** saja |
| Search list | satu input global di toolbar | + baris filter per kolom | **ADOPSI** baris filter per kolom |
| Filter kolom | dropdown per kolom ref/enum di toolbar | input filter di header + panel Filter Form | **ADOPSI** versi header; **jangan** duplikasi panel |
| Aksi baris | kebab menu (Lihat/Ubah/Duplikat/Hapus) muncul saat hover | ikon 👁 ✏️ selalu terlihat | **Hybrid** — ikon lihat/ubah selalu terlihat, sisanya di kebab |
| Hapus | delete guard + konfirmasi | tidak ada hapus; toggle status via badge | **ADOPSI** toggle status untuk master; pertahankan delete guard SIBA untuk data yang memang boleh dihapus |
| COA | tabel datar per level | tree view interaktif | **ADOPSI** — tambahkan tree sebagai view utama Account |
| Detail/edit | satu komponen, tab Informasi / Data Terkait / Record JSON | route `update?mode=view\|edit` | Setara. **Adopsi query param `mode`** agar URL bisa di-share |
| Tab anak | ada (Data Terkait) | ada + **hitungan di label tab** | **ADOPSI** hitungan di label |
| Panel kanan | audit trail + "Dipakai oleh" (296px) | drawer 384px / inline / tab | **Pertahankan SIBA**, tapi seragamkan: satu tempat saja |
| Diff audit | daftar perubahan | `Field: lama → baru` | **ADOPSI** format diff panah |
| Aksi simpan | (belum ada footer bar tetap) | tombol di page header | **ADOPSI** tombol utama di page header + tambahkan sticky footer bar saat form kotor (dirty) |
| Validasi | `.err` inline sudah ada | tidak ada | **Pertahankan SIBA** — ini keunggulan |
| Dropdown FK | `<select>` native terfilter | combobox portal dengan search + code chip, hanya record aktif | **ADOPSI** |
| Line item grid | belum ada | ada, sel berupa kontrol | **ADOPSI** untuk `acc_journal_line` |
| Balance strip | belum ada | ada, live | **ADOPSI** |
| Empty state | ikon + judul + teks + CTA | dua baris, CTA hanya bila relevan | **ADOPSI** varian tanpa-CTA untuk data yang dihasilkan proses |
| Toast | ada | tidak ada | **Pertahankan SIBA** |
| Command palette / shortcut | Ctrl+K, `/`, `N`, `Esc` | tidak ada | **Pertahankan SIBA** |
| Company switcher | ada di topbar | tidak ada | **Pertahankan SIBA** |
| Modal | 460px, ikon kiri + tombol kanan-bawah | 288px, semua rata tengah, chip subjek | **Adopsi chip subjek** + teks konsekuensi; pertahankan layout SIBA |

---

## 11. Daftar perubahan yang disarankan untuk mock-up

### Prioritas 1 — dampak besar, effort kecil

1. **Baris filter per kolom** di `thead` tabel `.grid`. Tambah `<tr class="filterrow">` dengan input mungil per kolom yang punya `filterable:true` di entity registry. Label kolom pertama: `FILTER`.
2. **Sel referensi dua baris.** Ubah `.ref-cell` dari `nama · KODE` sebaris menjadi nama bold di atas + kode mono `10,5px` di bawah.
3. **Chip subjek + teks konsekuensi di modal konfirmasi.** Tambahkan `<span class="tag mono">KODE – Nama</span>` dan kalimat yang menjelaskan akibat tindakan.
4. **Diff panah di audit trail:** `Status: Draft → Posted` dengan nilai lama muted.
5. **Hitungan record di label tab** `Data Terkait (3)`.
6. **Naikkan radius** token: `--r-sm:6px; --r:9px; --r-lg:12px`.

### Prioritas 2 — pola baru untuk modul berikutnya

7. **Tree view COA.** Halaman `acc_account` jadi tree Category → Subcategory → Account → Sub-account, dengan `Buka Semua` / `Tutup Semua`, search lintas level, hitungan anak di kanan node, dan chip tipe node. Sediakan toggle Tree/Tabel.
8. **Grid line item + balance strip** untuk `acc_journal`. Strip menampilkan status seimbang, selisih, total debit, total kredit — dihitung live. Amber saat belum seimbang, hijau saat seimbang. Blokir posting selama belum seimbang.
9. **Combobox FK dengan search.** Ganti `<select>` untuk FK berisi banyak baris (account, partner, item) dengan combobox: input filter di atas, opsi `code chip – nama`, dan **hanya record `is_active = true`** yang tampil (kecuali nilai yang sedang terpasang).
10. **Kartu konteks scope** di halaman yang bergantung fiscal year / company (Opening Balance, Journal list, laporan): satu pemilih editable + chip turunan read-only.
11. **Status badge sebagai toggle** untuk seluruh master: klik badge → modal konfirmasi aktif/non-aktif. Sejalan dengan keputusan "delete guard" yang sudah ada — data ber-referensi tidak dihapus, cukup dinonaktifkan.

### Prioritas 3 — konsistensi & poles

12. **Satu tempat untuk audit trail.** Pertahankan panel kanan 296px di SIBA untuk semua entitas; jangan tiru tiga penempatan Akui.
13. **Sticky action bar** saat form dirty (`Simpan` / `Batal` + indikator "perubahan belum disimpan"), melengkapi tombol utama di page header.
14. **Hint text rata kanan** di header section untuk tabel anak yang punya aksi tidak jelas (mis. "Klik ikon gembok untuk mengunci periode").
15. **Empty state dua varian:** dengan CTA (user bisa membuat) dan tanpa CTA + kalimat penjelas asal data (dihasilkan proses lain).
16. **Tombol collapse** pada sub-sidebar, memperlebar area konten untuk tabel lebar.
17. **Font mono yang lebih tegas** (JetBrains Mono / IBM Plex Mono) untuk kode, tanggal, dan angka; SIBA sudah memakai mono tapi lewat stack sistem.

### Tidak diadopsi (keputusan sadar)

- Skala root 12px dan label 8,4px.
- View mode berupa input ter-disable.
- Badge solid jenuh untuk atribut jamak.
- Panel Filter Form yang menduplikasi baris filter kolom.
- Menghapus shortcut keyboard dan command palette.
- Rail ikon tanpa label teks.

---

## 12. Pertanyaan terbuka

1. **Tree vs tabel untuk COA:** apakah tree menggantikan tabel Account, atau berdampingan sebagai toggle? Tree lebih baik untuk memahami struktur, tabel lebih baik untuk bulk-scan dan filter kolom.
2. **Toggle status vs hapus:** apakah SIBA mengadopsi kebijakan "master tidak pernah dihapus, hanya dinonaktifkan"? Ini keputusan data, bukan UI — memengaruhi DBML (`is_active` wajib di semua master) dan delete guard yang sudah dibuat.
3. **Filter aktif pada dropdown FK:** ketika sebuah record dinonaktifkan padahal masih terpasang di transaksi lama, bagaimana form edit menampilkannya? Akui Proto menyembunyikannya dari daftar pilihan — perlu perlakuan khusus untuk nilai eksisting.
4. **Bahasa:** Akui Proto mencampur Indonesia dan Inggris dengan pola yang sama seperti SIBA (istilah teknis tetap Inggris). Konvensi ini bisa dikunci.

---

## Sumber

Observasi langsung pada aplikasi berikut, sesi login milik pengguna (13 September 2026):

- `erp.prototype-akui.online/modules/erp/masters/partners`
- `erp.prototype-akui.online/modules/erp/masters/items` (+ `update?id=5&mode=view`)
- `erp.prototype-akui.online/modules/erp/accounting/chart-of-accounts/category`
- `erp.prototype-akui.online/modules/erp/accounting/chart-of-accounts/account` (+ `add`, `update?id=1&mode=view`)
- `erp.prototype-akui.online/modules/erp/accounting/journals` (+ `add`, `update?id=2&mode=view`)
- `erp.prototype-akui.online/modules/erp/accounting/period-and-balance/fiscal-period` (+ detail)
- `erp.prototype-akui.online/modules/erp/accounting/period-and-balance/opening-balance`

Pembanding lokal: `SIBA Mock Up Design/siba30_master_mockup.html`.
