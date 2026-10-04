# Referensi UI/UX — Akui Proto

> **Tujuan dokumen:** merekam pola desain **dan katalog komponen** aplikasi pembanding (Akui Proto) sebagai dasar untuk memperbaiki `siba30_master_mockup.html`, sekaligus menjadi *building repertoire* — resep kelas siap pakai untuk membangun layar baru.
>
> **Dua permukaan yang diobservasi:**
> 1. **`erp.prototype-akui.online`** — aplikasi ERP nyata. Modul **Masters** dan **Accounting** dianalisis mendalam; Dashboard, Purchasing, Logistics, Settings, Finance hanya dipetakan strukturnya.
> 2. **`sso.prototype-akui.online/components`** — *Component Showcase*, katalog resmi **30 komponen reusable** di `src/components`. Setiap komponen punya playground interaktif. Inilah sumber kebenaran (*source of truth*) untuk token & resep kelas.
>
> **Metode:** inspeksi langsung di browser — DOM, `getComputedStyle`, dan interaksi nyata (membuka dropdown, modal, drawer, toast). Semua angka adalah nilai terukur, bukan perkiraan.
>
> **Tanggal:** 13 September 2026 (ERP) · **15 September 2026** (Component Showcase, revisi ini).

---

## Daftar isi

| § | Isi |
|---|---|
| 1 | Ringkasan eksekutif |
| 2 | Peta aplikasi & navigasi |
| 3 | Design tokens (terkoreksi & diperluas) |
| 4 | **Katalog komponen — 30 komponen, 6 kategori** |
| 5 | List view (ERP) |
| 6 | Tree view — Chart of Accounts |
| 7 | Form view |
| 8 | Modal, drawer, overlay |
| 9 | State & pola presentasi lain |
| 10 | Inkonsistensi & hal yang jangan ditiru |
| 11 | Gap analysis terhadap `siba30_master_mockup.html` |
| 12 | Daftar perubahan yang disarankan |
| 13 | Pertanyaan terbuka |
| 14 | Sumber |

---

## 1. Ringkasan eksekutif

Akui Proto adalah aplikasi **React (React Router / Next-style) + Tailwind CSS v4** dengan karakter **light, sangat padat (dense), sudut sangat membulat, dan aksen kuning-slate**. Sistemnya lebih matang dari yang terlihat pada modul ERP saja: ada **design system terdokumentasi berisi 30 komponen** dengan playground sendiri.

**Lima hal yang paling layak diadopsi SIBA:**

1. **Filter per kolom langsung di dalam header tabel** (`DataTable`) — jauh lebih cepat daripada search tunggal.
2. **Tree view untuk COA** sebagai presentasi utama Chart of Accounts, bukan tabel datar.
3. **Balance summary strip** di bawah grid line item jurnal (Seimbang / Belum Seimbang + total debit/kredit live).
4. **Keluarga picker berlapis** (`Combobox` → `MasterCombobox` → `SearchableModalPicker` → `ReferencePicker`) — satu pola per tingkat kompleksitas data, bukan satu `<select>` untuk semuanya.
5. **`MasterTableCell` 2-baris** (nama tebal + kode mono) sebagai sel baku semua tabel master.

**Empat hal yang tidak boleh diadopsi:**

1. Skala font yang, di layar <1440px, menurunkan label form ke **8,4px** — terlalu kecil (lihat §3.1).
2. Mode "view" yang memakai input ter-disable, bukan penyajian read-only.
3. Audit trail yang diletakkan di tiga tempat berbeda tergantung entitas.
4. Dokumentasi komponen tanpa tabel props — showcase hanya menampilkan `<Button />` tanpa satu pun properti (lihat §10.15).

**Temuan struktural terpenting revisi ini:** skala root **tidak tetap 12px**. Ia responsif tiga langkah (12 / 14 / 16px). Semua angka absolut di dokumen versi sebelumnya berlaku untuk layar <1440px saja. Lihat §3.1.

---

## 2. Peta aplikasi & navigasi

### 2.1 Struktur IA — aplikasi ERP

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

### 2.2 Struktur IA — Component Showcase (`sso.` )

Shell yang **sama persis** dengan ERP dipakai ulang untuk katalog komponen. Rail ikon = kategori komponen; panel submenu = daftar komponen dalam kategori itu, dengan entri pertama selalu **`Semua di Kategori Ini`** + badge hitungan.

| Rail | Kategori | n | Komponen |
|---|---|---:|---|
| 1 | **Semua Komponen** | 30 | (gabungan seluruh kategori) |
| 2 | **Buttons & Actions** | 4 | Button, ActionView, ActionEdit, ActionDelete |
| 3 | **Data Display & Badges** | 5 | Badge, Card, DataTable, MasterTableCell, ScrollArea |
| 4 | **Form Controls & Inputs** | 3 | Input, Checkbox, Switch |
| 5 | **Selects & Pickers** | 9 | MasterCombobox, Combobox, MultiCombobox, SearchableList, SearchableModalPicker, ReferencePicker, DatePicker, DateRangePicker, DatePickerModal |
| 6 | **Feedback & Dialogs** | 3 | Modal, StatusConfirmModal, Toast |
| 7 | **Navigation & Layout** | 6 | Sidebar, AuditLogsSidebar, UserProfileNavbarItem, UserProfileModal, ChatWidget, MenuAccessGuard |

> **Rasio kategori yang berbicara:** 9 dari 30 komponen (30%) adalah *picker*. Ini aplikasi yang didominasi pemilihan data referensi — sama seperti SIBA. Investasi terbesar mereka ada di sana, dan SIBA sebaiknya meniru pembagiannya (§4.4).

Anomali penomoran: teks hero berbunyi *"Seluruh **27** komponen reusable"* sementara badge navbar, badge rail (`TTL 30`), dan daftar submenu semuanya menyebut **30**. Angka 27 tidak pernah dimutakhirkan (§10.14).

### 2.3 Pola URL (konsisten di seluruh app)

```
/modules/erp/<modul>/<grup>/<entitas>                            → list view
/modules/erp/<modul>/<grup>/<entitas>/add                        → create
/modules/erp/<modul>/<grup>/<entitas>/update?id=<n>&mode=view    → detail (read-only)
/modules/erp/<modul>/<grup>/<entitas>/update?id=<n>&mode=edit    → edit
/components                                                      → katalog komponen (SSO)
/home · /modules                                                 → portal
```

Satu route `update` melayani view **dan** edit lewat query param `mode`. Pola ini bagus dan sudah sejalan dengan pendekatan single-component SIBA (create + view + edit).

### 2.4 Shell layout

```
┌──────────────────────────────────────────────────────────┐
│ header  fixed  h-16   bg-white/95 backdrop-blur-md  z-30 │ ← logo kiri · search tengah · user chip kanan
├──┬───────────┬───────────────────────────────────────────┤
│▓▓│  panel    │  main                                     │
│▓▓│  submenu  │  p-3 / sm:p-4 / lg:p-6                    │
│▓▓│  (float)  │  space-y-6                                │
└──┴───────────┴───────────────────────────────────────────┘
   ↑ rail ikon floating (2 kartu terpisah)
```

Spesifikasi terukur ada di **§4.6.1 (`Sidebar`)**. Ringkasnya: rail `fixed left-3 top-[76px] bottom-3`, dua kartu `w-16` `bg-[#1d2633]` `rounded-2xl shadow-xl`; panel submenu `ml-3 w-60 min-w-[220px] max-w-[250px]`.

Perbedaan penting antara kedua permukaan:

| | ERP | Component Showcase |
|---|---|---|
| Top bar | logo + chip user saja | logo + **2 badge status** + **search global** + tombol `Portal Utama` + chip user |
| Search | tidak ada | `Cari komponen (misal: Badge, Modal, Combobox)...` di header **dan** `Filter komponen...` di panel submenu |

Showcase membuktikan komponen search global **sudah ada**; ERP hanya belum memakainya (§10.12).

---

## 3. Design tokens

### 3.1 Root scale responsif — koreksi penting

Versi sebelumnya dokumen ini menyatakan `html { font-size: 12px }` tetap. **Itu keliru.** Root font-size Akui Proto **responsif tiga langkah**:

| Lebar viewport | `html` font-size | 1 rem = |
|---|---|---|
| < 1440px (mis. 1024, 1280, 1400) | **12px** | 12px |
| 1440px – ±1919px (mis. 1440, 1600, 1792) | **14px** | 14px |
| ≥ ±1920px | **16px** | 16px |

*Diverifikasi empiris pada 1024 / 1280 / 1400 / 1440 / 1600 / 1792 / 1920 px.* Aturannya tidak terlihat di `cssRules` (kemungkinan di-`@media` dalam bundle Tailwind), jadi ambang atas dinyatakan sebagai "±1920".

Konsekuensi: **seluruh skala rem Tailwind ikut bergeser**. Angka absolut apa pun harus selalu disertai konteks root-nya.

#### Skala tipografi terukur

| Kelas | Nominal | root 12px | root 14px | root 16px |
|---|---|---|---|---|
| `text-[10px]` | 10px | 10 | 10 | 10 |
| `text-[0.7rem]` *(label form)* | — | **8,4** | **9,8** | 11,2 |
| `text-xs` (0.75rem) | 12px | **9** | **10,5** | 12 |
| `text-[0.85rem]` *(input)* | — | **10,2** | **11,9** | 13,6 |
| `text-sm` (0.875rem) | 14px | 10,5 | **12,25** | 14 |
| `text-base` (1rem) | 16px | 12 | **14** | 16 |
| `text-lg` | 18px | 13,5 | 15,75 | 18 |
| `text-xl` *(judul komponen)* | 20px | 15 | **17,5** | 20 |
| `text-2xl` *(judul halaman)* | 24px | **18** | **21** | 24 |
| `text-3xl` | 30px | 22,5 | 26,25 | 30 |

#### Skala radius terukur

| Kelas | Nominal | root 12px | root 14px | root 16px |
|---|---|---|---|---|
| `rounded-md` *(badge)* | 6px | 4,5 | **5,25** | 6 |
| `rounded-lg` *(tombol sm, chip)* | 8px | 6 | **7** | 8 |
| `rounded-xl` *(input, tombol md)* | 12px | **9** | **10,5** | 12 |
| `rounded-2xl` *(kartu)* | 16px | **12** | **14** | 16 |
| `rounded-3xl` *(kartu besar, modal konfirmasi)* | 24px | **18** | **21** | 24 |
| `rounded-[2rem]` *(Modal utama)* | — | 24 | **28** | 32 |
| `rounded-full` | — | pill | pill | pill |

> **Rekomendasi tetap:** ambil *proporsi* dan *ritme* mereka, jangan skala absolutnya. Pada laptop 1366px (mayoritas pengguna ERP di Indonesia) root turun ke 12px dan label form menjadi **8,4px** — di bawah ambang keterbacaan wajar untuk aplikasi akuntansi yang dipakai seharian. Tiga langkah root itu sendiri ide bagus; yang salah adalah titik awalnya terlalu rendah. SIBA sebaiknya memakai **14 / 15 / 16px**, bukan 12 / 14 / 16px.

### 3.2 Warna (nilai terukur)

| Peran | Kelas | Nilai | Catatan |
|---|---|---|---|
| Background app | `bg-[#F4F6F8]` | `#F4F6F8` | |
| Surface / card | `bg-white` | `#FFFFFF` | |
| Border card | `border-slate-200/90` | — | hairline 1px |
| Teks utama | `text-brand-blue` | **`#3E495A`** | slate-blue, bukan biru terang |
| Teks di atas primary | `text-snow` | **`#FFFAFA`** | putih hangat, bukan `#FFF` |
| Teks sekunder | `text-slate-500` | `#64748B` | |
| Teks header tabel | `text-slate-400` | `#94A3B8` | |
| Aksen | `bg-brand-yellow` | **`#DBC360`** | state aktif, halaman aktif, opsi terpilih |
| Aksen kuning terang | `bg-amber-400` | `#FBBF24` | badge hitungan, tanggal terpilih di kalender |
| Rail gelap | `bg-[#1d2633]` | `#1D2633` | |
| Sukses / ACTIVE / POSTED / RELEASE | `bg-emerald-600` | `#059669` | badge solid |
| Bahaya / INACTIVE / REJECT | `bg-rose-600` | `#E11D48` | badge solid |
| Tombol danger | `bg-rose-500` | `#F43F5E` | |
| Info / SELLABLE | `bg-blue-800` | `#1E40AF` | |
| Netral / DRAFT | `bg-slate-100` + `border-slate-200` + `text-slate-700` | — | satu-satunya badge non-solid |
| Tombol filter apply (ERP) | — | `#D9B84C` | hover `#CBAA3E`, active `#BD9C32` |
| Tombol reset (ERP) | — | `#E2E8F0` | |

**Catatan:** ada set CSS variable dark theme lengkap di `:root` (`--bg-app:#090d16`, `--accent-supabase:#3ecf8e`, `--sidebar-width:290px`, `--drawer-width:380px`, dst.) yang **tidak dipakai sama sekali** — sisa boilerplate. Nilai nyata semuanya datang dari kelas Tailwind. Abaikan variabel-variabel itu; ia juga muncul identik di kedua permukaan, menegaskan bahwa ini kode mati.

### 3.3 Shadow (nilai terukur)

| Kelas | Nilai |
|---|---|
| `shadow-2xs` | `0 1px 0 0 rgb(0 0 0 / .05)` — hairline, dipakai pada hampir semua input & tombol outline |
| `shadow-sm` | `0 1px 3px 0 rgb(0 0 0 / .1), 0 1px 2px -1px rgb(0 0 0 / .1)` — kartu |
| `shadow-lg` | `0 10px 15px -3px rgb(0 0 0 / .1), 0 4px 6px -4px rgb(0 0 0 / .1)` — tombol primer (+ tint `shadow-brand-blue/20`) |
| `shadow-xl` | `0 20px 25px -5px …` — rail, panel submenu |
| `shadow-2xl` | `0 25px 50px -12px rgb(0 0 0 / .25)` — modal, drawer, dropdown portal |

Toast memakai shadow kustom: `shadow-[0_25px_60px_-15px_rgba(0,0,0,0.15)]`.

### 3.4 Font & weight

- **Plus Jakarta Sans** (UI, dari Google Fonts, weight 200–800) + **JetBrains Mono** (kode, ID, angka, tanggal).
- Stack lengkap: `--font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.
- Font-weight dipakai sangat berat: `font-bold` (700) untuk hampir semua label & tombol, `font-black` (900) untuk judul halaman & kode dokumen, `font-extrabold` (800) untuk label field.
- **Aturan mono yang konsisten dan layak ditiru:** semua **kode entitas**, **tanggal ISO**, **nominal uang**, dan **angka stok** memakai `font-mono`. Nama manusia tidak pernah mono.

---

## 4. Katalog komponen

Sumber: `sso.prototype-akui.online/components`, mode **Semua di Kategori Ini** (seluruh 30 komponen dirender sekaligus dalam satu DOM).

### 4.0 Shell kartu komponen (pola dokumentasi)

Setiap komponen dibungkus kartu identik — pola yang bagus untuk *style guide* SIBA sendiri:

```html
<section id="component-<slug>"
  class="rounded-2xl border p-4 sm:p-6 bg-white border-slate-200/90 shadow-sm
         shadow-slate-200/30 !p-6 rounded-3xl hover:shadow-md transition-shadow">

  <!-- header: nama · path file · badge kategori · deskripsi · Copy Import -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-5 border-b border-slate-100 gap-3">
    <div>
      <div class="flex items-center gap-2 mb-1 flex-wrap">
        <h2 class="text-xl font-black text-brand-blue tracking-tight">Button</h2>
        <span class="font-mono text-[11px] font-bold text-slate-500 bg-slate-100
                     px-2 py-0.5 rounded-md border border-slate-200">src/components/Button.tsx</span>
        <span class="…badge…">Buttons &amp; Actions</span>
      </div>
      <p class="text-xs text-slate-500">Tombol serbaguna dengan varian …</p>
    </div>
    <button class="…btn sm outline…">Copy Import</button>
  </div>

  <!-- playground -->
  <div class="py-6"> … demo langsung, dikelompokkan per aspek … </div>

  <!-- footer: contoh kode -->
  <div class="mt-4 pt-4 border-t border-slate-100"> … <pre> … </pre> </div>
</section>
```

Label kelompok demo: `text-[11px] font-bold text-slate-400 uppercase tracking-wider block`, bernomor — `1. Variasi Warna & Model (Variant)`, `2. Ukuran (Size) & Ikon`, `3. State (Loading & Disabled)`.

---

### 4.1 Buttons & Actions (4)

#### 4.1.1 `Button` — `src/components/Button.tsx`

Base class (selalu ada):

```
inline-flex items-center justify-center gap-2 font-bold transition-all duration-200
active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
```

**Varian** (5):

| Varian | Kelas tambahan |
|---|---|
| `primary` | `bg-brand-blue text-snow shadow-lg shadow-brand-blue/20 hover:scale-[1.02]` |
| `secondary` | `bg-slate-100 text-slate-600 hover:bg-slate-200` |
| `outline` | `border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-2xs` |
| `danger` | `bg-rose-500 text-white shadow-lg shadow-rose-500/20 hover:scale-[1.02]` |
| `ghost` | `bg-transparent text-slate-500 hover:bg-slate-50` |

**Ukuran** (3):

| Size | Kelas | Tinggi @root 12px | @root 14px |
|---|---|---|---|
| `sm` | `px-3 py-1.5 text-[0.7rem] rounded-lg` | ±21,6px | **25,2px** |
| `md` *(default)* | `px-4 py-2.5 text-[0.85rem] rounded-xl` | ±30,3px | **35,3px** |
| `lg` | `px-6 py-3.5 text-base rounded-2xl` | ±39px | **45,5px** |

**State:** `loading` (spinner menggantikan ikon), `disabled` (`opacity-50`, tanpa `active:scale`). Ikon opsional di kiri, jarak `gap-2`.

> Catatan penting: **efek hover adalah `scale`**, bukan perubahan warna, untuk primary & danger. Micro-interaction ini (`hover:scale-[1.02]` / `active:scale-[0.98]`) dipakai konsisten di seluruh sistem dan murah untuk ditiru.

#### 4.1.2–4.1.4 `ActionView` · `ActionEdit` · `ActionDelete`

Icon-button baku untuk kolom **AKSI** di tabel. Ketiganya terdaftar terpisah — keputusan sadar agar semua tabel memakai ikon & warna yang sama.

| Komponen | Kelas | Idle | Hover |
|---|---|---|---|
| `ActionView` | `p-1.5 rounded-lg text-slate-400 hover:text-brand-blue hover:bg-brand-blue/5 transition-colors` | slate-400 | brand-blue |
| `ActionEdit` | *Button ghost sm* + `text-blue-400 hover:text-blue-600 hover:bg-blue-50` | blue-400 | blue-600 |
| `ActionDelete` | *Button ghost sm* + `text-rose-400 hover:text-rose-600 hover:bg-rose-50` | rose-400 | rose-600 |

Semua punya `title` (tooltip native: `View Details`) dan state `disabled` (`opacity-50 cursor-not-allowed`).

Grup aksi dipisah dengan `pl-4 border-l border-slate-200`.

> **Inkonsistensi:** deskripsi resmi `ActionEdit` berbunyi *"Icon button standar **kuning/amber**"*, tetapi kelas sebenarnya `text-blue-400`. `ActionView` (biru) dan `ActionEdit` (biru) jadi sulit dibedakan tanpa membaca ikon. Lihat §10.20.
>
> **Catatan arsitektur:** `ActionView` **tidak** dibangun di atas `Button`, sedangkan `ActionEdit`/`ActionDelete` iya. Akibatnya padding ketiganya berbeda (`p-1.5` vs `px-3 py-1.5`).

---

### 4.2 Data Display & Badges (5)

#### 4.2.1 `Badge` — 7 varian baku

Base:

```
inline-flex items-center gap-1 font-bold rounded-md tracking-wider uppercase transition-colors
```

| Varian | Kelas | Dipakai untuk |
|---|---|---|
| `success` | `bg-emerald-600 border border-emerald-600 text-white` | ACTIVE · POSTED · RELEASE · APPROVED |
| `warning` | `bg-brand-yellow border border-brand-yellow text-white` | peringatan, gold |
| `danger` | `bg-rose-600 border border-rose-600 text-white` | INACTIVE · REJECT · BLOCK · HAPUS |
| `info` | `bg-blue-800 border border-blue-800 text-white` | SELLABLE, biru tua |
| `neutral` | `bg-slate-100 border border-slate-200 text-slate-700` | DRAFT · DEFAULT · **code chip** |
| `blue` | `bg-brand-blue border border-brand-blue text-white` | PRODUCTION, label kategori |
| `yellow` | `bg-brand-yellow border border-brand-yellow text-brand-blue` | HIGHLIGHT (teks gelap, bukan putih) |

**Ukuran:**

| Size | Kelas | Tinggi @14px | Font |
|---|---|---|---|
| `sm` | `px-2 py-0.5 text-[10px]` | 19,8px | 10px |
| `md` *(default)* | `px-2.5 py-1 text-xs` | 22,3px | 10,5px |

Keduanya mendukung ikon di kiri (`gap-1`).

**Pola turunan penting — code chip:** varian `neutral` + `font-mono tracking-tight font-bold shrink-0` adalah *chip kode entitas* baku, dipakai di tabel, combobox, tree, dan dropdown. Satu resep, empat tempat:

```html
<span class="inline-flex items-center gap-1 font-bold rounded-md tracking-wider uppercase
             px-2 py-0.5 text-[10px] bg-slate-100 border border-slate-200 text-slate-700
             font-mono tracking-tight shrink-0">WLT-RAW-001</span>
```

> `warning` dan `yellow` memakai background identik (`brand-yellow`) dan hanya berbeda warna teks (putih vs brand-blue). Dua nama untuk satu warna — lihat §10.13.

#### 4.2.2 `Card`

```html
<div class="rounded-2xl border p-4 sm:p-6 bg-white border-slate-200/90 shadow-sm shadow-slate-200/30">
```

Menerima `className` tambahan; varian *dashed* memakai `bg-slate-50 border-dashed border-slate-300`. Judul internal: `font-bold text-slate-800 text-sm mb-1`, body `text-xs text-slate-500`.

#### 4.2.3 `DataTable` — komponen paling penting

Fitur: pencarian otomatis per kolom, sorting per kolom, pagination, page-size, custom render per sel, toggle Filter Form.

**Struktur DOM:**

```
div.flex.flex-col.w-full
├─ div.flex…justify-between.gap-3.pb-3.5           ← toolbar
│   ├─ h3.text-lg.font-bold.text-brand-blue.tracking-tight     ← judul tabel
│   └─ div.ml-auto  [Filter] [SHOW 10 ⌄]
├─ div.relative.overflow-x-auto.w-full
│   └─ table.w-full.text-left.border-collapse.min-w-full
│       ├─ thead
│       │   ├─ tr.bg-slate-50/70.border-y.border-slate-100     ← baris label
│       │   └─ tr.bg-slate-50/40.border-b.border-slate-100     ← baris FILTER
│       └─ tbody
└─ div.flex…justify-between.pt-4.border-t.border-slate-100     ← pagination
```

**Header (`th`):**

```
px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 whitespace-nowrap
```
Kolom yang bisa di-sort menambahkan `cursor-pointer hover:text-brand-blue group transition-colors`. Perataan per kolom eksplisit: `text-left` / `text-center` / `text-right` (angka selalu `text-right`).

**Baris filter per kolom** (`tr` kedua):

- Sel pertama: `px-4 py-1.5 text-right` berisi `<span class="text-[9px] font-bold text-slate-300 uppercase tracking-widest">Filter</span>`.
- Sel lain: `px-3 py-1.5` berisi
  ```html
  <div class="relative flex items-center min-w-[110px]">
    <SearchIcon/>
    <input placeholder="Filter KODE ITEM..."
      class="w-full min-w-[100px] pl-7 pr-6 py-1 bg-white border border-slate-200/80 rounded-lg
             text-xs font-medium placeholder:text-slate-300 focus:border-brand-blue
             focus:ring-1 focus:ring-brand-blue/20 outline-hidden transition-all shadow-2xs">
  </div>
  ```
- Placeholder **menyebut nama kolom** (`Filter NAMA BARANG...`) — menghapus pertanyaan "ini mencari di kolom mana".

**Body:**

- `tr`: `transition-colors duration-150 group/row hover:bg-slate-100/90 cursor-default`
- `td`: `px-4 py-2.5 whitespace-nowrap transition-colors` + perataan kolom
- Kolom NO: `text-right font-bold font-mono text-slate-400 group-hover/row:text-brand-blue` — nomor baris ikut menyala saat hover, memakai `group/row`
- **Tinggi baris terukur: 38px** (@root 12px)

**Toolbar:**

```html
<button class="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold bg-white
               text-brand-blue border border-slate-200/90 shadow-2xs hover:bg-slate-50"
        title="Toggle Filter Form"><FilterIcon/><span class="hidden sm:inline">Filter</span></button>

<button class="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200/90
               hover:border-slate-300 shadow-2xs">
  <span class="text-[10px] font-bold text-brand-blue/30 uppercase tracking-widest">Show</span>
  <span class="text-xs font-bold text-brand-blue flex items-center gap-1">10<ChevronIcon/></span>
</button>
```

Label tombol Filter disembunyikan di layar kecil (`hidden sm:inline`) — ikon saja.

**Pagination:**

- Kiri: `<span class="text-[10px] font-bold text-brand-blue/30 uppercase tracking-widest">Page 1 of 1 (4 total)</span>`
- Kanan: `«` `‹` — *Button ghost sm* + `bg-slate-50 border border-slate-100`
- Halaman aktif: `w-8 h-8 rounded-lg text-xs font-bold bg-brand-yellow text-black shadow-md`

> Penggunaan `text-brand-blue/30` untuk teks meta (30% opasitas dari `#3E495A`) adalah trik yang rapi: warnanya tetap satu keluarga dengan teks utama, tidak melompat ke abu netral.

#### 4.2.4 `MasterTableCell` — sel 2-baris baku

> *"Baris 1: Nama tebal, Baris 2: Label/Kode kecil monospace"* — standar resmi untuk **semua** tabel Data Master ERP.

```html
<td class="py-3 px-4">
  <div class="flex flex-col min-w-0">
    <div class="flex items-center gap-1.5 flex-wrap">
      <span class="font-bold text-slate-800 text-xs sm:text-sm truncate">Sarang Burung Walet Mangkok Super Grade AAA</span>
      <span class="…badge blue sm… font-mono tracking-tight shrink-0">RAW</span>   <!-- tag tipe, opsional -->
    </div>
    <span class="text-[11px] text-slate-400 font-mono tracking-tight">WLT-RAW-001</span>
  </div>
</td>
```

Tabel pembungkusnya lebih ringan dari `DataTable` (dipakai untuk tabel anak / read-only):

```
border border-slate-200/80 rounded-2xl overflow-hidden bg-white shadow-2xs
thead tr : bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500 font-bold uppercase tracking-wider
th/td    : py-3 px-4
tbody    : divide-y divide-slate-100
tr hover : hover:bg-slate-50/60 transition-colors
```

Kolom angka: `font-mono font-bold text-slate-700` (mis. `125.50 KG`, `310 BOX`).

> **Ini pola yang paling langsung bisa diadopsi SIBA** dan menggantikan `.ref-cell` gaya `nama · KODE` sebaris. Perhatikan `min-w-0` + `truncate` — tanpa keduanya nama panjang akan merusak lebar tabel.

#### 4.2.5 `ScrollArea`

```html
<div class="overflow-auto relative scrollbar-thin scrollbar-track-transparent
            scrollbar-thumb-slate-200 hover:scrollbar-thumb-slate-300
            transition-all duration-300 p-4 bg-slate-50 rounded-2xl border border-slate-200"
     style="max-height:160px">
```

Scrollbar tipis yang menggelap saat hover. Ada juga kelas utilitas `custom-scrollbar` dan `no-scrollbar` yang dipakai di dropdown portal, drawer, dan rail.

---

### 4.3 Form Controls & Inputs (3)

#### 4.3.1 `Input`

Anatomi lengkap satu field:

```html
<div class="flex flex-col gap-1 w-full">
  <label class="text-[0.7rem] font-extrabold text-slate-500 uppercase tracking-widest px-1">
    Label Input Standar
    <span class="text-rose-500 font-bold">*</span>          <!-- wajib -->
  </label>

  <div class="relative w-full">
    <div class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Icon/></div>
    <input class="w-full px-4 py-2.5 rounded-xl border transition-all duration-200 outline-hidden
                  text-[0.85rem] font-medium text-slate-800 placeholder:text-slate-300
                  pl-10                                     <!-- hanya bila ada prefix icon -->
                  bg-white hover:bg-white focus:bg-white
                  border-slate-200 hover:border-slate-300
                  focus:border-brand-yellow focus:ring-4 focus:ring-brand-yellow/10 shadow-2xs">
  </div>

  <span class="text-[0.7rem] text-slate-400 italic px-1">Helper text penjelas format input.</span>
</div>
```

| Aspek | Nilai |
|---|---|
| Tinggi terukur | **31,5px** @root 12px · **36,7px** @root 14px |
| Padding | `8,75px 14px` (@14px) |
| Radius | 10,5px (@14px) |
| Focus ring | `focus:border-brand-yellow focus:ring-4 focus:ring-brand-yellow/10` — **kuning**, bukan biru |
| Error | `border-red-400 focus:border-red-400 focus:ring-red-100` + pesan `text-[0.7rem] font-semibold text-red-500 px-1` |
| Helper | `text-[0.7rem] text-slate-400 italic px-1` |
| Disabled / view | `bg-slate-100/80 border-slate-200 text-slate-500 cursor-not-allowed shadow-2xs select-none` |

> Ini **merekonsiliasi** angka "32px" pada versi sebelumnya dokumen ini: pengukuran itu diambil di layar <1440px (root 12px). Nilai kanonik komponen adalah `px-4 py-2.5 text-[0.85rem]`, yang menghasilkan 31,5 / 36,7 / 42px pada tiga langkah root.
>
> **Perhatikan asimetri warna fokus:** `Input` fokus **kuning**, tetapi filter kolom `DataTable` fokus **biru** (`focus:border-brand-blue`). Dua bahasa fokus dalam satu aplikasi — §10.13.

#### 4.3.2 `Checkbox`

Teknik `peer` + `appearance-none`, ikon centang di-overlay:

```html
<label class="group flex items-center gap-2 cursor-pointer">
  <div class="relative flex items-center justify-center">
    <input type="checkbox" class="peer appearance-none w-5 h-5 rounded-md border-2 border-slate-200
      bg-white transition-all duration-200 checked:bg-brand-blue checked:border-brand-blue
      focus:ring-4 focus:ring-brand-blue/10 outline-hidden
      disabled:bg-slate-50 disabled:border-slate-100
      disabled:checked:bg-slate-200 disabled:checked:border-slate-200">
    <CheckIcon/>   <!-- absolut di atas, tampil via peer-checked -->
  </div>
  <span class="text-[0.85rem] font-bold tracking-tight transition-colors duration-200
               text-brand-blue/70 group-hover:text-brand-blue">Aktifkan Pemrosesan Otomatis</span>
</label>
```

Kotak `w-5 h-5` dengan `border-2` — tegas, tidak hilang di tengah form padat. Label sentence case, ikut menggelap saat hover pada seluruh `label` (`group`).

#### 4.3.3 `Switch`

```html
<button type="button" role="switch" aria-checked="true"
  class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full
         transition-colors duration-150 ease-out
         focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:ring-offset-2
         bg-emerald-500 active:scale-95">          <!-- off: bg-slate-200 -->
  <span class="inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 pointer-events-none"
        style="transform: translateX(22px)"></span>   <!-- off: translateX(2px) -->
</button>
```

On = `bg-emerald-500`, off = `bg-slate-200`, disabled = `opacity-50 cursor-not-allowed`. **Satu-satunya komponen dengan `role`/`aria-*` yang benar** — sisanya mengandalkan `title` saja (§10.10).

> Kontras dengan ERP: di sana status aktif/non-aktif diubah dengan **klik pada status badge** → modal konfirmasi, bukan dengan `Switch`. `Switch` dipakai untuk pengaturan, badge-toggle untuk data master. Pembagian ini masuk akal dan layak ditiru.

---

### 4.4 Selects & Pickers (9) — kelompok terpenting

Sembilan komponen ini membentuk **tangga** dari pemilihan paling ringan ke paling berat. Pilih berdasarkan jumlah data dan jumlah kolom yang perlu dilihat saat memilih:

| # | Komponen | Bentuk | Pilih ketika |
|---|---|---|---|
| 1 | `SearchableList` | list inline dalam kartu | opsi sedikit (≤10), ingin semuanya terlihat tanpa klik |
| 2 | `Combobox` | dropdown portal + search | single-select, opsi sedang, satu baris teks cukup |
| 3 | `MasterCombobox` | dropdown portal + search | **data master ERP** — butuh format `KODE - Nama` |
| 4 | `MultiCombobox` | dropdown + chips | multi-select |
| 5 | `SearchableModalPicker` | modal + search + pagination | data banyak, butuh **2 baris** (nama + kode) + info tambahan |
| 6 | `ReferencePicker` | field + tombol `Select` → modal kaya | **dokumen transaksi** (PO/PR/kontrak) — butuh status, vendor, tanggal, nominal |
| 7 | `DatePicker` | field + kalender portal | tanggal tunggal |
| 8 | `DateRangePicker` | field ganda | rentang tanggal |
| 9 | `DatePickerModal` | field + kalender modal | tanggal tunggal di dalam konteks sempit/modal lain |

#### 4.4.1 Panel dropdown portal (dipakai `Combobox`, `MasterCombobox`, `MultiCombobox`, `DatePicker`)

Di-portal ke `<body>`, `position: fixed`, `z-index: 999999`, lebar mengikuti trigger (`width` di-set inline, `max-width: 560px`):

```html
<div class="bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden
            pointer-events-auto flex flex-col max-h-[340px]">
  <!-- sub-header pencarian -->
  <div class="p-2.5 border-b border-slate-100 bg-slate-50/50">
    <div class="relative"><SearchIcon/>
      <input placeholder="Cari berdasarkan nama, label, atau kode..."
        class="w-full pl-9 pr-4 py-2 bg-white rounded-xl text-xs font-semibold text-slate-800
               outline-hidden border border-slate-200/90 focus:border-brand-yellow
               focus:ring-2 focus:ring-brand-yellow/15 transition-all">
    </div>
  </div>

  <!-- daftar opsi -->
  <div class="overflow-y-auto p-1.5 custom-scrollbar space-y-1 flex-1">
    <button class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left
                   transition-all bg-brand-yellow/15 border border-brand-yellow/30
                   text-brand-blue shadow-2xs">        <!-- TERPILIH -->
      <div class="flex flex-col min-w-0 pr-2">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="…code chip…">WLT-RAW-001</span>
          <span class="text-slate-400 font-bold shrink-0">-</span>
          <span class="font-bold text-xs text-slate-800">Sarang Burung Walet Mangkok Super Grade AAA</span>
        </div>
      </div>
      <div class="w-5 h-5 rounded-full bg-brand-yellow text-slate-900 flex items-center
                  justify-center shrink-0 ml-2 shadow-2xs"><CheckIcon/></div>
    </button>

    <button class="w-full … hover:bg-slate-50 text-slate-700 border border-transparent"> … </button>
  </div>
</div>
```

Tiga detail yang layak ditiru:
1. **Opsi terpilih** = latar `brand-yellow/15` + border `brand-yellow/30` + **lingkaran centang kuning** di kanan. Tidak bergantung warna teks saja.
2. Opsi tidak terpilih tetap punya `border border-transparent` — mencegah pergeseran layout 1px saat terpilih.
3. Format opsi **selalu** `[code chip] - [nama]`, identik dengan tampilan tabel dan tree. Pengguna bisa mencari dengan kode maupun nama.

> **Perilaku yang benar dan harus ditiru:** hanya record aktif yang muncul di daftar pilihan (di ERP, Bank BCA yang `NON AKTIF` tidak tampil sebagai pilihan subkategori).
>
> **Kelemahan:** `Esc` tidak menutup dropdown (§10.10).

#### 4.4.2 `MasterCombobox`

Trigger:

```html
<div class="relative flex items-center w-full min-h-[42px] pl-10 pr-12 py-2 rounded-xl border
            transition-all duration-200 shadow-2xs bg-white border-slate-200/90
            hover:border-slate-300 text-slate-800 cursor-pointer text-xs font-medium overflow-hidden">
  <div class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Icon/></div>
  <div class="flex-1 min-w-0 flex items-center gap-2 truncate">
    <span class="…code chip…">WLT-RAW-001</span>
    <span class="text-slate-400 font-bold shrink-0">-</span>
    <span class="font-bold text-slate-800 truncate text-xs">Sarang Burung Walet Mangkok Super Grade AAA</span>
  </div>
  <div class="absolute right-3 flex items-center gap-1">
    <button title="Hapus Pilihan" class="p-1 hover:bg-slate-100 rounded-md text-slate-400 hover:text-slate-600"><XIcon/></button>
    <ChevronIcon/>
  </div>
</div>
<span class="text-[10px] text-slate-400 font-medium px-1 mt-0.5">Format tampilan: LABEL - NAMA BARANG …</span>
```

`min-h-[42px]` (bukan tinggi tetap) supaya isi dua-elemen tidak terpotong. Tombol clear `×` + chevron selalu di kanan.

Showcase juga menampilkan **kartu penjelas standar** — pola dokumentasi yang bagus:

```html
<div class="p-3.5 bg-blue-50/60 border border-blue-100 rounded-xl text-xs text-brand-blue space-y-1">
  <p class="font-bold flex items-center gap-1.5"><InfoIcon/> Standar Searchable Combobox ERP:</p>
  <p>Tampilkan format <strong>label - name</strong> …</p>
</div>
```

Kartu info `bg-blue-50/60 border-blue-100 text-brand-blue rounded-xl` ini dipakai di beberapa tempat sebagai *inline hint* — layak dipakai SIBA untuk menjelaskan aturan bisnis di dalam form.

#### 4.4.3 `Combobox`

Versi ringan: trigger `pl-3.5 pr-12 py-2.5 rounded-xl text-[0.85rem]` tanpa prefix icon, `min-h` tidak dipakai. Mendukung *keyboard navigation* dan *opsi kosong*. Nilai terpilih ditampilkan sebagai `[code chip] - [nama]` yang sama.

#### 4.4.4 `MultiCombobox`

```html
<div class="relative flex flex-wrap items-center gap-1.5 w-full px-3 py-2 rounded-xl border
            cursor-pointer transition-all duration-200 min-h-[42px] border-slate-200
            hover:border-slate-300 bg-white">
  <span class="flex items-center gap-1 px-2 py-1 bg-brand-blue text-snow text-[0.7rem]
               font-bold rounded-lg group/tag">
    Gudang Utama Jakarta
    <button class="hover:text-brand-yellow transition-colors"><XIcon/></button>
  </span>
  …
  <div class="ml-auto flex items-center pr-1"><ChevronIcon/></div>
</div>
```

Chip = `bg-brand-blue text-snow rounded-lg`; tombol `×` di dalam chip menguning saat hover. `flex-wrap` + `min-h-[42px]` → field tumbuh ke bawah.

> Label di sini memakai `text-brand-blue/40` sedangkan `Input` memakai `text-slate-500`. Dua warna label dalam satu sistem — §10.13.

#### 4.4.5 `SearchableList`

List inline, tidak ada portal:

```html
<div class="flex flex-col gap-3 w-full bg-slate-50 p-4 rounded-2xl border border-slate-100">
  <div class="flex items-center justify-between px-1">
    <span class="text-[0.7rem] font-bold text-brand-blue/40 uppercase tracking-widest">Pilih Master Data</span>
    <span class="text-[10px] font-bold text-brand-blue/20">4 Items</span>
  </div>
  <div class="relative"><SearchIcon/>
    <input placeholder="Filter list..." class="w-full pl-9 pr-4 py-2 bg-white rounded-xl text-xs
      font-semibold outline-hidden border border-slate-200 focus:border-brand-yellow/50 transition-all">
  </div>
  <div class="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1 -mr-1 custom-scrollbar">
    <button class="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold
                   transition-all bg-white hover:bg-white/80 border border-transparent hover:border-slate-200">
      <span class="truncate">[RAW] - Sarang Burung Walet Mentah</span>
    </button>
  </div>
</div>
```

Trik kecil yang bagus: `pr-1 -mr-1` memberi ruang scrollbar tanpa menggeser konten.

#### 4.4.6 `SearchableModalPicker`

**Trigger 2-baris** (nama + kode, pola `MasterTableCell` dibawa ke dalam field):

```html
<div class="relative flex items-center w-full pl-3 pr-8 py-1.5 min-h-[42px] rounded-xl border
            shadow-2xs text-xs bg-white hover:bg-slate-50/50 border-slate-200/90 cursor-pointer">
  <div class="flex-1 min-w-0 pr-1 flex flex-col justify-center leading-tight">
    <span class="font-bold text-slate-800 truncate block text-[12px]">Pembelian Sarang Walet Grade AAA</span>
    <span class="text-[10.5px] font-mono text-slate-400 truncate block">PO-2026-001</span>
  </div>
  <div class="absolute right-2 flex items-center gap-1"><button title="Hapus Pilihan">…</button><ChevronIcon/></div>
</div>
```

**Modal picker** — struktur 4 bagian (header / search / list / footer):

```html
<div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[2001]"></div>
<div class="fixed inset-0 flex items-center justify-center p-4 z-[2002] pointer-events-none">
  <div class="bg-white w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden pointer-events-auto
              border border-slate-100 max-h-[85vh] flex flex-col">

    <div class="p-5 pb-4 border-b border-slate-100 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-brand-yellow/10 flex items-center justify-center text-brand-yellow shrink-0"><Icon/></div>
        <div>
          <h3 class="text-base font-bold text-slate-900 tracking-tight">Pilih Dokumen Purchase Order</h3>
          <p class="text-xs text-slate-500 mt-0.5">Format 2-Baris: Baris 1 Nama Dokumen, Baris 2 Kode Dokumen &amp; Vendor</p>
        </div>
      </div>
      <button class="p-1.5 hover:bg-slate-100 rounded-xl text-slate-400"><XIcon/></button>
    </div>

    <div class="p-4 bg-slate-50/70 border-b border-slate-100">
      <input placeholder="Cari data..." class="w-full pl-10 pr-9 py-2.5 bg-white border
        border-slate-200/90 focus:border-brand-yellow rounded-xl text-xs font-semibold
        outline-hidden shadow-2xs transition-all placeholder:text-slate-400">
    </div>

    <div class="flex-1 overflow-y-auto p-3 divide-y divide-slate-50 custom-scrollbar max-h-[50vh]">
      <button class="w-full flex items-center justify-between p-3 rounded-xl text-left mb-1
                     bg-brand-yellow/10 border border-brand-yellow/30 text-slate-900 shadow-2xs">
        <div class="flex flex-col gap-0.5 pr-3 min-w-0">
          <span class="font-bold text-slate-800 truncate block text-[13px]">Pengadaan Bahan Kimia Pembersih</span>
          <span class="text-[11px] font-mono text-slate-400 truncate block">PO-2026-004</span>
          <span class="text-[11px] text-slate-500 font-normal truncate block">Supplier: PT Citra Kimia Farma</span>
        </div>
        <div class="w-6 h-6 rounded-full bg-brand-yellow text-slate-900 flex items-center justify-center"><CheckIcon/></div>
      </button>
    </div>

    <div class="p-3 px-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
      <span>Total <strong>4</strong> data</span>
      <button class="…btn outline md… !py-1.5 !px-3 text-xs">Tutup</button>
    </div>
  </div>
</div>
```

Perhatikan pola **scrim terpisah dari panel** (`z-[2001]` vs `z-[2002]`) dengan `pointer-events-none` di kontainer dan `pointer-events-auto` di panel — memungkinkan animasi terpisah tanpa memblok klik.

#### 4.4.7 `ReferencePicker`

Untuk dokumen transaksi. Field + tombol `Select` bersebelahan:

```html
<div class="flex items-center gap-2 w-full">
  <div class="relative flex-1 flex items-center px-3.5 py-2.5 rounded-xl border text-xs
              bg-slate-50 hover:bg-white border-slate-300 hover:border-brand-blue
              text-slate-800 cursor-pointer shadow-2xs">
    <Icon/>
    <div class="flex-1 truncate font-mono font-bold text-slate-800">[PO/2026/03/0014] - PT Sumber Alam Walet</div>
    <button title="Hapus / Reset Pilihan" class="p-1 text-slate-400 hover:text-rose-500
            rounded-lg hover:bg-slate-200/60 mr-1"><XIcon/></button>
  </div>
  <button class="…btn outline md… !py-2.5 !px-3.5 !text-xs shrink-0">Select</button>
</div>
<p class="text-[11px] text-slate-500 px-1 mt-0.5">Klik pada field atau tombol 'Select' di samping untuk membuka modal pemilihan referensi.</p>
```

Field berlatar `bg-slate-50` (bukan putih) untuk menandakan "ini bukan input ketik". Hover → putih + border `brand-blue`.

**Modal referensi** memakai `Modal` biasa (`max-w-2xl`, `rounded-[2rem]`) berisi kartu info + daftar baris kaya:

```html
<div class="divide-y divide-slate-100 border border-slate-200/90 rounded-2xl overflow-hidden bg-white shadow-2xs">
  <div class="p-3.5 hover:bg-slate-50/80 flex items-center justify-between gap-4 cursor-pointer group bg-amber-50/40">
    <div class="space-y-1">
      <div class="flex items-center gap-2">
        <span class="font-mono text-xs font-black text-brand-blue bg-blue-50 px-2 py-0.5 rounded
                     border border-blue-100 group-hover:bg-blue-100">PO/2026/03/0014</span>
        <span class="…badge success sm…">Approved</span>
      </div>
      <div class="text-xs font-bold text-slate-800">Pengadaan Sarang Burung Walet Grade AAA (100 Kg)</div>
      <div class="text-[11px] text-slate-500 flex items-center gap-2.5">
        <span>Vendor: <strong class="text-slate-700">PT Sumber Alam Walet</strong></span><span>•</span><span>Tgl: 2026-03-01</span>
      </div>
    </div>
    <div class="text-right shrink-0 flex flex-col items-end gap-1.5">
      <span class="font-mono text-xs font-bold text-slate-900">Rp 48.500.000</span>
      <button class="…btn primary sm… !py-1 !px-3 !text-xs">Terpilih</button>
    </div>
  </div>
</div>
```

Baris terpilih ditandai `bg-amber-50/40` — jauh lebih lembut daripada `brand-yellow/15` di dropdown. **Tiga intensitas sorot untuk satu makna** (§10.13).

#### 4.4.8 `DatePicker` + kalender portal

Trigger:

```html
<div class="relative flex items-center w-full pl-10 pr-4 py-2.5 rounded-xl border bg-white
            border-slate-200 hover:border-slate-300 cursor-pointer text-[0.85rem] font-medium">
  <CalendarIcon/><span class="text-brand-blue">September 7th, 2026</span>
</div>
```

Kalender (portal, `fixed`, `width: 320px`, `z-index: 999999`):

```html
<div class="p-4 bg-white rounded-2xl shadow-2xl border border-slate-200/90 pointer-events-auto">
  <div class="flex items-center justify-between mb-4 px-1">
    <div class="flex items-center gap-1.5">
      <button class="px-2.5 py-1 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-amber-100
                     hover:text-amber-900 border border-slate-200/80 rounded-xl flex items-center gap-1">September<ChevronIcon/></button>
      <button class="… sama …">2026<ChevronIcon/></button>
    </div>
    <div class="flex items-center gap-1 shrink-0">
      <button title="Bulan Sebelumnya" class="p-1.5 text-slate-600 hover:bg-slate-100 rounded-xl"><ChevronLeft/></button>
      <button title="Bulan Berikutnya" class="p-1.5 …"><ChevronRight/></button>
    </div>
  </div>

  <div class="grid grid-cols-7 gap-1 mb-2">
    <div class="text-[10px] font-bold text-slate-400 text-center uppercase tracking-tighter">Ming</div>
    … Sen Sel Rab Kam Jum Sab …
  </div>

  <div class="grid grid-cols-7 gap-1 text-center"> … tombol hari … </div>
</div>
```

**Empat state hari:**

| State | Kelas |
|---|---|
| Bulan lain | `text-slate-300 hover:bg-slate-100` |
| Normal | `text-slate-800 hover:bg-slate-100` |
| **Terpilih** | `bg-amber-400 text-slate-950 font-bold shadow-xs` |
| **Hari ini** | `border border-amber-400 text-amber-700 font-bold` (outline, bukan fill) |

Base hari: `py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer`.

Bulan & tahun adalah **tombol terpisah yang bisa dibuka**, bukan panah saja — navigasi lintas tahun jadi satu klik. Nama hari dalam bahasa Indonesia (`Ming Sen Sel Rab Kam Jum Sab`). Nilai keluaran selalu ISO (`2026-09-07`).

#### 4.4.9 `DateRangePicker`

Dua slot dalam satu bingkai:

```html
<div class="flex items-center gap-2 p-1.5 border rounded-xl bg-white border-slate-200
            cursor-pointer hover:border-slate-300">
  <div class="flex-1 flex items-center gap-2 px-2 py-1 bg-slate-50 rounded-lg">
    <CalendarIcon/><span class="text-[0.75rem] font-bold text-brand-blue">Sep 01, 2026</span>
  </div>
  <div class="h-4 w-px bg-slate-200"></div>
  <div class="flex-1 flex items-center gap-2 px-2 py-1 bg-slate-50 rounded-lg">
    <CalendarIcon/><span class="text-[0.75rem] font-bold text-brand-blue">Sep 30, 2026</span>
  </div>
</div>
```

Pemisah `h-4 w-px bg-slate-200`, bukan ikon panah. Ada validasi keterikatan tanggal (end ≥ start).

#### 4.4.10 `DatePickerModal`

Kalender yang sama, dibungkus modal `max-w-md rounded-[2rem] p-6 sm:p-7`, `z-[999999]`, dengan tambahan:

- **Header bertile ikon:** `w-10 h-10 rounded-2xl bg-amber-50 border border-amber-100 text-amber-600 shadow-2xs` + judul `text-base font-black text-brand-blue` + subtitle `text-[11px] text-slate-400`.
- **Footer konfirmasi** (tidak ada di versi popover):
  ```html
  <div class="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-slate-100">
    <div class="text-xs font-bold text-slate-600 truncate">15 September 2026</div>
    <div class="flex items-center gap-2">
      <button class="…btn secondary md…">Batal</button>
      <button class="…btn primary md…">Terapkan</button>
    </div>
  </div>
  ```
- Tombol bulan/tahun sedikit lebih besar (`px-3 py-1.5` + `shadow-2xs`), tombol hari `py-2` (bukan `py-1.5`).

Trigger memakai gaya `SearchableModalPicker` (`min-h-[42px] pl-9 pr-8 py-1.5`) dengan nilai `font-mono`.

> **Perbedaan perilaku yang penting:** `DatePicker` (popover) menerapkan pilihan **seketika**; `DatePickerModal` butuh `Terapkan`. Pakai yang pertama untuk filter, yang kedua untuk field yang mengubah data.

---

### 4.5 Feedback & Dialogs (3)

#### 4.5.1 `Modal`

```html
<div class="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-4 overflow-hidden">
  <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"></div>
  <div class="relative bg-white w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden
              pointer-events-auto border border-slate-100 max-h-[97vh] flex flex-col z-10">
    <div class="p-6 sm:p-7 overflow-y-auto custom-scrollbar">

      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-bold text-brand-blue tracking-tight">Demo Standard Modal</h2>
        <button class="p-2 hover:bg-slate-50 rounded-xl text-slate-400 hover:text-slate-600"><XIcon/></button>
      </div>

      <p class="text-slate-500 text-[0.9rem] leading-relaxed mb-6 font-medium">Dialog modal serbaguna …</p>

      <div class="mb-6"> … konten … </div>

      <div class="flex justify-end gap-3 mt-8">
        <button class="…btn outline md…">Tutup</button>
        <button class="…btn primary md…">Konfirmasi Aksi</button>
      </div>
    </div>
  </div>
</div>
```

| Properti | Nilai |
|---|---|
| Scrim | `bg-slate-900/60 backdrop-blur-sm` |
| Radius | `rounded-[2rem]` = 24 / **28** / 32px |
| Lebar | `max-w-md` (default) · `max-w-2xl` (varian lebar, mis. ReferencePicker) |
| Tinggi maks | `max-h-[97vh]` + `overflow-y-auto custom-scrollbar` |
| Padding | `p-6 sm:p-7` |
| Footer | rata kanan, `gap-3`, outline + primary |
| Varian | `default`, `danger` |

#### 4.5.2 `StatusConfirmModal`

Dialog khusus aktivasi/non-aktivasi. **Rata tengah**, lebih sempit, dengan tile ikon dan chip subjek:

```html
<div class="fixed inset-0 z-[9999] flex items-center justify-center p-4">
  <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"></div>
  <div class="relative z-10 bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl
              border border-slate-100 space-y-5 text-center font-sans">

    <div class="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center border shadow-inner
                bg-rose-50 text-rose-500 border-rose-100"><AlertIcon/></div>

    <div class="space-y-2">
      <h3 class="font-extrabold text-slate-800 text-lg tracking-tight">Nonaktifkan Master Item</h3>
      <div class="inline-block bg-slate-100 text-slate-800 font-bold text-xs px-3 py-1 rounded-lg
                  border border-slate-200/80 max-w-full truncate">WLT-RAW-01 (Sarang Walet Mangkok Super)</div>
      <p class="text-xs text-slate-500 leading-relaxed font-medium">Apakah Anda yakin ingin menonaktifkan item ini dari transaksi pemesanan?</p>
    </div>

    <div class="flex items-center gap-3 pt-2">
      <button class="…btn secondary md… flex-1 text-slate-600 font-semibold">Batal</button>
      <button class="…btn primary md… flex-1 !bg-rose-600 hover:!bg-rose-700 !text-white">Ya, Nonaktifkan</button>
    </div>
  </div>
</div>
```

Tiga hal yang layak ditiru:
1. **Tile ikon `w-14 h-14 rounded-2xl` dengan `shadow-inner`** — lebih tegas daripada lingkaran tipis.
2. **Chip subjek** berisi `KODE (Nama)` — pengguna melihat persis apa yang diubah.
3. Body menjelaskan **konsekuensi**, bukan sekadar "yakin?". Di ERP kalimatnya lebih panjang: *"Data yang nonaktif tidak akan muncul pada pilihan transaksi/operasional…"*.

Kedua tombol `flex-1` (lebar sama). Tombol destruktif memakai `!important` untuk menimpa varian primary — jejak bahwa varian `danger` belum dipakai di sini (§10.13).

#### 4.5.3 `Toast`

```html
<div class="fixed bottom-10 right-10 z-[1000] flex items-center gap-4 p-5 rounded-[2rem]
            shadow-[0_25px_60px_-15px_rgba(0,0,0,0.15)] bg-white/70 backdrop-blur-2xl
            min-w-[340px] border-none">
  <div class="absolute left-4 w-1.5 h-8 rounded-full bg-emerald-500 opacity-20"></div>   <!-- aksen -->
  <div class="relative flex items-center gap-4 w-full pl-2">
    <div class="shrink-0"><Icon/></div>
    <div class="flex-1">
      <p class="text-[0.9rem] font-bold text-brand-blue/80 tracking-tight leading-tight">Data berhasil disimpan secara aman!</p>
    </div>
    <button class="p-2 hover:bg-slate-900/5 rounded-xl text-slate-400 hover:text-brand-blue group"><XIcon/></button>
  </div>
  <div class="absolute bottom-0 left-8 right-8 h-[2px] bg-slate-100 rounded-full overflow-hidden opacity-40">
    <div class="h-full bg-emerald-500" style="width: 83.5%"></div>                        <!-- timer -->
  </div>
</div>
```

| Tipe | Aksen & progress bar | Pesan contoh |
|---|---|---|
| `success` | `bg-emerald-500` | Data berhasil disimpan secara aman! |
| `error` | `bg-rose-500` | Terjadi kesalahan koneksi! |
| `warning` | **`undefined`** ← bug | Harap periksa kembali kelengkapan field! |
| `info` | `bg-brand-blue` | Informasi: data telah disinkronisasi. |

Tiga detail bagus: **glassmorphism** (`bg-white/70 backdrop-blur-2xl`), **progress bar timer** yang menyusut di dasar kartu, dan **pita aksen vertikal** di kiri alih-alih mewarnai seluruh kartu.

> **Bug nyata:** varian `warning` merender `class="… rounded-full undefined opacity-20"` — tidak ada warna yang dipetakan. Peta warna kehilangan kunci `warning`. Lihat §10.16.
>
> ERP **tidak memakai Toast sama sekali** meski komponennya ada dan berfungsi (§10.17).

---

### 4.6 Navigation & Layout (6)

#### 4.6.1 `Sidebar` — dual rail

> Deskripsi resmi: *"Primary Rail 92px + Secondary Submenu 268px"*. **Nilai terukur berbeda** — lihat catatan di bawah.

```html
<div class="fixed left-3 top-[76px] bottom-3 z-40 flex items-start">
  <div class="flex flex-col gap-2.5 h-full z-50">

    <!-- kartu atas: Home Portal, Semua Modules -->
    <div class="w-16 bg-[#1d2633] border border-slate-800 rounded-2xl shadow-xl
                flex flex-col items-center py-3 gap-2 px-2 shrink-0">
      <a href="/home"    class="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center
                                justify-center text-slate-300 hover:text-white transition-all"><Icon/></a>
      <a href="/modules" class="… sama …"><Icon/></a>
    </div>

    <!-- kartu bawah: modul / kategori, scrollable -->
    <div class="w-16 flex-1 bg-[#1d2633] border border-slate-800 rounded-2xl shadow-xl
                flex flex-col items-center justify-between py-3 px-2 min-h-0 overflow-hidden">
      <div class="overflow-y-auto no-scrollbar w-full flex flex-col items-center gap-2">
        <button class="w-10 h-10 rounded-xl flex items-center justify-center relative
                       bg-brand-yellow text-brand-blue font-bold shadow-md shadow-brand-yellow/30
                       ring-2 ring-white/20"><Icon/></button>          <!-- AKTIF -->
        <button class="w-10 h-10 rounded-xl … bg-white/5 hover:bg-white/10
                       text-slate-300 hover:text-white"><Icon/></button>
      </div>

      <!-- footer rail: penghitung total -->
      <div class="w-full pt-2 mt-2 border-t border-white/10 flex flex-col items-center">
        <div class="w-10 h-10 rounded-xl bg-white/5 text-slate-400 flex flex-col items-center
                    justify-center text-[10px] font-bold font-mono">
          <span class="text-[8px] uppercase tracking-tighter text-slate-500">TTL</span>
          <span class="text-amber-400 font-extrabold text-[11px] leading-tight">30</span>
        </div>
      </div>
    </div>
  </div>

  <!-- panel submenu -->
  <div class="ml-3 w-60 min-w-[220px] max-w-[250px] h-full bg-white border border-slate-200/80
              rounded-2xl shadow-xl shadow-slate-200/50 flex flex-col p-4 overflow-hidden z-40">

    <div class="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 shrink-0">
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="w-8 h-8 rounded-xl bg-brand-blue/10 text-brand-blue flex items-center
                    justify-center font-bold shrink-0"><Icon/></div>
        <span class="font-bold text-slate-800 text-base truncate">Semua Komponen</span>
      </div>
      <button title="Sembunyikan menu" class="w-7 h-7 rounded-full border border-slate-200 bg-white
        hover:bg-slate-50 text-slate-400 hover:text-slate-700 flex items-center justify-center shadow-2xs shrink-0"><ChevronIcon/></button>
    </div>

    <div class="mb-2 relative shrink-0"><SearchIcon/>
      <input placeholder="Filter komponen..." class="w-full text-xs pl-8 pr-3 py-1.5 bg-slate-50
        rounded-xl border border-slate-200 focus:outline-none focus:border-brand-blue
        focus:bg-white transition-all font-medium">
    </div>

    <div class="flex-1 overflow-y-auto custom-scrollbar space-y-1 pr-1">
      <button class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs sm:text-sm
                     font-semibold bg-brand-blue text-white shadow-sm shadow-brand-blue/20 font-bold">
        <span class="truncate">Semua di Kategori Ini</span>
        <span class="ml-2 px-2 py-0.5 text-[10px] font-black rounded-full font-mono
                     bg-amber-400 text-slate-900">30</span>
      </button>
      <button class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs sm:text-sm
                     font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100/80">
        <span class="truncate">Button</span>
      </button>
    </div>
  </div>
</div>
```

| Elemen | Nilai terukur |
|---|---|
| Rail (kartu) | `w-16` → **48px @root 12px** / 56px @14px (bukan 92px seperti deskripsi) |
| Rail + gutter kiri + gap | total ±**76px** → *inilah kemungkinan asal angka "92px"* |
| Item rail | `w-10 h-10` = 30px @12px |
| Panel submenu | `w-60 min-w-[220px] max-w-[250px]` → terukur **±250px** (bukan 268px) |
| Header sticky app | `h-16` |
| Rail top offset | `top-[76px]` (= tinggi header + gutter) |

Item rail aktif: `bg-brand-yellow text-brand-blue font-bold shadow-md shadow-brand-yellow/30 ring-2 ring-white/20`.

**Tooltip rail** (portal, muncul saat hover):

```html
<div class="fixed left-[84px] -translate-y-1/2 z-[9999] flex items-center pointer-events-none
            animate-in fade-in zoom-in-95 duration-150" style="top:409px">
  <div class="w-0 h-0 border-y-[6px] border-y-transparent border-r-[7px] border-r-slate-900"></div>
  <div class="bg-slate-900 text-white text-xs font-bold px-3 py-1.5 rounded-md shadow-xl
              whitespace-nowrap flex items-center gap-2">
    <span>Navigation &amp; Layout</span>
    <span class="bg-amber-400 text-slate-900 text-[10px] font-black px-1.5 py-0.2 rounded-full">6</span>
  </div>
</div>
```

Segitiga penunjuk dibuat dengan trik border CSS, bukan SVG. Tooltip **membawa hitungan** — informasi, bukan sekadar label.

> `py-0.2` pada badge tooltip bukan kelas Tailwind yang valid (skala spacing tidak punya `0.2`) — tidak menghasilkan padding vertikal apa pun.

#### 4.6.2 `AuditLogsSidebar`

Drawer kanan dua lapis. **Lapis luar** (trigger drawer di showcase): `fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex justify-end` + panel `w-full max-w-md bg-white h-full shadow-2xl flex flex-col`.

**Lapis dalam** (drawer audit sebenarnya):

```html
<div class="fixed inset-0 z-[100] flex justify-end overflow-hidden">
  <div class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm"></div>
  <div class="relative w-full max-w-lg bg-white h-full shadow-2xl border-l border-slate-200
              z-[101] flex flex-col">

    <div class="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
      <div class="flex items-center gap-3">
        <div class="p-2 rounded-xl bg-blue-50 text-blue-600"><HistoryIcon/></div>
        <div>
          <h3 class="font-bold text-slate-800 text-base tracking-tight">Riwayat Perubahan</h3>
          <p class="text-xs text-slate-500">Log aktivitas Master Item Demo</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200/80 text-slate-600
                       font-semibold text-xs rounded-lg">Collapse All</button>
        <button class="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><XIcon/></button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-6 space-y-4">
      <!-- satu entri -->
      <div class="rounded-2xl border border-slate-100 bg-slate-50/30 p-4 space-y-3">

        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-full border border-slate-200 bg-white flex items-center
                      justify-center text-slate-400 shrink-0"><UserIcon/></div>
          <div>
            <div class="font-semibold text-slate-800 text-xs">it@akui.com</div>
            <div class="text-[11px] text-slate-400">18 Agu 2026 • 14:43</div>
          </div>
        </div>

        <!-- timeline rail + node -->
        <div class="relative pl-5 pt-1">
          <div class="absolute left-1.5 top-2 bottom-2 w-0.5 bg-slate-200/80 rounded-full"></div>
          <div class="absolute left-0 top-3.5 w-3 h-3 rounded-full bg-slate-200/80 flex items-center justify-center">
            <div class="w-1.5 h-1.5 rounded-full bg-white"></div>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between text-xs font-semibold text-slate-700">
              <div class="flex items-center gap-2">
                <span>Master Item / Barang</span>
                <span class="…badge warning sm…">UPDATE</span>
              </div>
              <button class="text-slate-400 hover:text-slate-600 text-[11px] font-normal
                             flex items-center gap-1">Sembunyikan<ChevronIcon/></button>
            </div>

            <div class="bg-slate-50/80 rounded-xl p-3 border border-slate-100 space-y-2 text-xs">
              <div class="font-bold text-slate-800 text-xs">CHONG</div>
              <div class="text-slate-700 leading-relaxed">
                <span class="font-semibold text-slate-800">Nama: </span>
                <span class="text-slate-800 font-medium">CHONG</span>
              </div>

              <!-- perubahan pada tabel anak: nested, diberi garis kiri -->
              <div class="space-y-2 pl-3 border-l-2 border-slate-200/70">
                <span>Konversi Satuan Item (UoM Conversion)</span> <span class="…badge success sm…">TAMBAH</span>
                … Satuan (UoM): 2 · ID Item: 1 · Faktor Konversi: 1000 …
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

**Action badge:** `TAMBAH` = success (emerald) · `UPDATE` = warning (brand-yellow) · `HAPUS` = danger (rose).

Dua hal yang layak ditiru:
1. **Nested audit** — perubahan pada tabel anak (`UoM Conversion`) muncul di dalam entri induk, diberi `pl-3 border-l-2 border-slate-200/70`. Satu aksi user = satu entri, bukan tiga.
2. **Nama tabel manusiawi** (`Master Item / Barang`, `Konversi Satuan Item (UoM Conversion)`), bukan nama teknis. Di ERP sempat muncul `acc_account` mentah — showcase memperbaikinya.

> **Yang belum ada:** format diff panah. Drawer ini hanya menampilkan `Field: nilai`, bukan `Field: lama → baru`. Format panah muncul di ERP (`Status Jurnal: Draft → Posted`) tetapi belum masuk komponen (§10.18).
>
> Lebar drawer: `max-w-lg` terukur **336px** @root 12px (≈384px @14px). Opasitas scrim drawer `40%` vs modal `60%` (§10.8).

#### 4.6.3 `UserProfileNavbarItem`

Chip avatar di header + dropdown:

```html
<div class="z-[101] absolute right-0 top-full mt-2">
  <div class="w-80 bg-white rounded-2xl shadow-xl border border-slate-200/90 overflow-hidden flex flex-col font-sans">

    <div class="p-4 pb-3.5 border-b border-slate-100 flex items-start gap-3">
      <div class="relative shrink-0">
        <div class="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 text-brand-blue
                    font-black text-base flex items-center justify-center shadow-2xs">IT</div>
        <span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white"></span>
      </div>
      <div class="min-w-0 flex-1">
        <h3 class="font-bold text-sm text-slate-900 truncate leading-tight">it-tester</h3>
        <p class="text-xs text-slate-400 font-medium truncate mt-0.5">it-tester@email.com</p>
        <span class="text-[10px] font-bold px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md
                     border border-blue-200/60 leading-none">User / Administrator</span>
      </div>
    </div>

    <div class="p-3 space-y-2 bg-slate-50/60">
      <div class="flex items-center gap-2.5 px-3 py-2 bg-white rounded-xl border border-slate-100 shadow-2xs text-xs">
        <Icon/>
        <div class="min-w-0 flex-1">
          <span class="text-[10px] text-slate-400 font-semibold block uppercase tracking-wider">Status Pegawai</span>
          <span class="font-bold text-slate-800 truncate block">AKTIF</span>
        </div>
      </div>
    </div>

    <div class="p-2 border-t border-slate-100 bg-white">
      <button class="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-semibold text-rose-600
                     hover:text-rose-700 hover:bg-rose-50/80 rounded-xl group"><LogoutIcon/><span>Log out</span></button>
    </div>
  </div>
</div>
```

Avatar inisial `rounded-xl` (bukan lingkaran) dengan **dot status online** `bg-emerald-500 ring-2 ring-white`. Dropdown tiga zona: identitas / data turunan / aksi destruktif. Badge role memakai palet `blue-50/blue-700/blue-200` yang **tidak ada** di 7 varian `Badge` baku (§10.13).

#### 4.6.4 `UserProfileModal`

Modal detail profil, daftar role akses, dan informasi karyawan terkait.

> **Demo rusak:** di showcase, menekan `Buka UserProfileModal` hanya merender `<div class="fixed inset-0 z-[100] bg-transparent">` — scrim transparan tanpa panel. Komponen tampaknya bergantung pada anchor/konteks yang hanya ada di navbar nyata. Spesifikasi visualnya tidak bisa diukur dari showcase (§10.16).

#### 4.6.5 `ChatWidget`

FAB global, integrasi Gemini API:

```html
<div id="ai-chat-widget-root" class="fixed right-6 bottom-6 z-50 flex flex-col items-end transition-all">
  <button title="Buka Asisten AI"
    class="w-14 h-14 bg-brand-blue hover:bg-brand-blue/95 text-white rounded-full shadow-2xl
           flex items-center justify-center cursor-pointer group relative border-2 border-brand-yellow/80">
    <div class="relative">
      <BotIcon/>
      <span class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-brand-yellow rounded-full
                   ring-2 ring-brand-blue animate-pulse"></span>
    </div>
  </button>
</div>
```

`w-14 h-14`, border kuning 2px, badge berdenyut (`animate-pulse`). Posisi `right-6 bottom-6`, `z-50`.

> **Tabrakan z-index:** `ChatWidget` `z-50` dan `Toast` `z-[1000]` sama-sama di kanan-bawah (`right-6 bottom-6` vs `right-10 bottom-10`). Toast akan menutupi FAB sebagian (§10.19).

#### 4.6.6 `MenuAccessGuard`

Wrapper proteksi hak akses (CRUD permissions) berbasis RBAC Supabase. Bukan komponen visual — merender `children` bila diizinkan. Tampilan "diizinkan" di showcase:

```html
<div class="p-3 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-200 flex items-center gap-2">
  <CheckIcon/><span class="font-bold">Akses Diizinkan: Konten di dalam MenuAccessGuard berhasil dirender dengan aman.</span>
</div>
```

> Tidak ada demo untuk state **ditolak**. Tampilan "akses ditolak" tidak terdokumentasi — padahal itu justru state yang perlu dirancang (§10.16).

---

### 4.7 Resep cepat (copy-paste)

Untuk membangun layar baru, sembilan resep ini menutup ±90% kebutuhan. Nilai ditulis sebagai kelas, bukan px, agar ikut skala root.

| Kebutuhan | Resep |
|---|---|
| **Kartu** | `rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-6 shadow-sm shadow-slate-200/30` |
| **Kartu info / hint** | `p-3.5 bg-blue-50/60 border border-blue-100 rounded-xl text-xs text-brand-blue flex items-center gap-2` |
| **Label field** | `text-[0.7rem] font-extrabold text-slate-500 uppercase tracking-widest px-1` (+ `<span class="text-rose-500 font-bold">*</span>`) |
| **Input** | `w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-[0.85rem] font-medium text-slate-800 placeholder:text-slate-300 shadow-2xs outline-hidden focus:border-brand-yellow focus:ring-4 focus:ring-brand-yellow/10 transition-all duration-200` |
| **Tombol primer** | `inline-flex items-center justify-center gap-2 font-bold px-4 py-2.5 text-[0.85rem] rounded-xl bg-brand-blue text-snow shadow-lg shadow-brand-blue/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200` |
| **Code chip** | `inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold font-mono tracking-tight uppercase rounded-md bg-slate-100 border border-slate-200 text-slate-700 shrink-0` |
| **Status badge** | `inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md bg-emerald-600 border border-emerald-600 text-white` |
| **Header tabel** | `px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 whitespace-nowrap` |
| **Baris tabel** | `tr`: `group/row hover:bg-slate-100/90 transition-colors duration-150` · `td`: `px-4 py-2.5 whitespace-nowrap` |
| **Sel master 2-baris** | `div.flex.flex-col.min-w-0` → `span.font-bold.text-slate-800.text-xs.truncate` + `span.text-[11px].text-slate-400.font-mono.tracking-tight` |
| **Overlay panel** | `bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden` (+ `fixed`, `z-[999999]` bila portal) |
| **Scrim** | modal `bg-slate-900/60 backdrop-blur-sm` · drawer `bg-slate-900/40 backdrop-blur-sm` |
| **Sorot "terpilih"** | `bg-brand-yellow/15 border border-brand-yellow/30 shadow-2xs` + lingkaran centang `w-5 h-5 rounded-full bg-brand-yellow` |

**Skala z-index yang dipakai** (perlu dirapikan sebelum ditiru — §10.19):

| Lapis | z |
|---|---|
| Rail sidebar | `z-40` / `z-50` |
| Header | `z-30` |
| ChatWidget FAB | `z-50` |
| Dropdown profil | `z-[101]` |
| Drawer audit | `z-[100]` / `z-[101]` |
| Toast | `z-[1000]` |
| SearchableModalPicker | `z-[2001]` / `z-[2002]` |
| StatusConfirmModal | `z-[9999]` |
| Tooltip rail | `z-[9999]` |
| Modal | `z-[99999]` |
| DatePickerModal, dropdown portal | `z-[999999]` |

---

## 5. List view (ERP)

### 5.1 Anatomi halaman

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

Tabelnya adalah komponen `DataTable` (§4.2.3) — spesifikasi kelas lengkapnya ada di sana dan tidak diulang di sini. Yang berikut adalah hal-hal yang khusus ERP.

### 5.2 Panel "Filter Form" (redundan — lihat §10.6)

Tombol `Filter` di toolbar membuka panel di dalam kartu (bukan modal/drawer):

- Judul `FILTER FORM` + ikon corong, tombol `×` di kanan.
- Grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-y-3 gap-x-4`.
- Label field di sini **sentence case** ("Tipe Akun") — beda dengan header tabel yang uppercase.
- Aksi kanan-bawah: `Filter` (kuning `#d9b84c`) + `Reset` (abu `#e2e8f0`), keduanya `px-4 py-1.5 rounded-xl font-bold text-xs`.

Panel ini berisi field yang **sama persis** dengan baris filter per kolom.

### 5.3 Presentasi sel

| Pola | Contoh | Implementasi |
|---|---|---|
| **Sel dua baris (FK)** | `Aktiva Lancar` (bold) di atas `SUB00001` (mono, abu) | komponen `MasterTableCell` (§4.2.4) |
| **Code chip** | `CAT00001`, `FY00002`, `ITM00006` | `Badge` varian `neutral` + `font-mono` (§4.2.1) |
| **Status badge** | `AKTIF` / `NON AKTIF` / `OPEN` / `DRAFT` / `POSTED` | `Badge` solid |
| **Badge properti jamak** | `BELI` `JUAL` `STOK` `EXPIRABLE` `PRODUKSI` | wrap ke beberapa baris, tinggi baris menyesuaikan |
| **Sub-badge di bawah nama** | `Cup Mangkok` + `VARIANT` | menandai atribut turunan |
| **Tanggal & angka** | `2026-01-01`, `Rp 17.800` | selalu `font-mono` |

### 5.4 Kolom aksi

Ikon saja, selalu terlihat: `ActionView` (👁) dan `ActionEdit` (✏️) — komponen §4.1.2–4.1.4. **Tidak ada tombol hapus di list master.** Penghapusan digantikan toggle status via badge (§9).

`ActionDelete` tetap ada sebagai komponen dan dipakai di grid line item (menghapus baris jurnal), bukan di list master.

---

## 6. Tree view — Chart of Accounts

Halaman `chart-of-accounts/account` **tidak** memakai `DataTable`. Ini presentasi paling menarik di aplikasi ini.

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

**Anatomi node:**

```
group flex items-center justify-between py-2 px-3 rounded-xl border border-transparent
hover:bg-slate-100/80 hover:border-slate-200/60 text-xs cursor-pointer
```

- Kiri: slot chevron/dot `w-5 h-5` (dot `w-1.5 h-1.5 rounded-full bg-slate-300` untuk leaf) → type chip (`CATEGORY` = `Badge` blue / `SUBCAT` = `Badge` yellow) → code chip mono → separator `–` → nama (`truncate font-semibold text-slate-800`).
- Kanan: badge properti (normal balance `DEBIT`/`KREDIT`, indikator postable/control/require-partner sebagai kotak ikon `w-5 h-5 rounded-md` berwarna dengan tooltip) → ikon aksi (`ActionView`, `ActionEdit`, Lihat Detail B-Tree).
- Node induk menampilkan **hitungan anak** di kanan (`3 Subkategori`, `3 Akun`) — pola yang sama dengan badge hitungan di panel submenu (§4.6.1) dan tab (§7.8).
- Node non-aktif ditampilkan miring/pudar + badge `NON AKTIF`.
- Indentasi lewat garis vertikal tipis di kiri — teknik yang sama dengan timeline audit (§4.6.2).

Search bar di kartu terpisah di atas tree, lebar penuh, mencari di semua level sekaligus.

> Format node (`[chip kode] – [nama]`) identik dengan format opsi `Combobox`/`MasterCombobox` (§4.4.1). **Satu bahasa penyajian entitas di seluruh aplikasi** — ini kekuatan utama sistem mereka dan hal termudah untuk ditiru.

---

## 7. Form view

### 7.1 Header halaman form

```
[←] [ENTERPRISE RESOURCE PLANNING] / ACCOUNTING / CHART OF ACCOUNTS
    ⚖ Detail Akun Bagan / ACC00001 [AKTIF]      [🕘 Riwayat Perubahan 1]
```

- Tombol back = lingkaran putih berbingkai di kiri breadcrumb (`w-7 h-7 rounded-full border border-slate-200 bg-white shadow-2xs`, sama dengan tombol collapse submenu).
- Judul + kode (mono) + status badge dalam satu baris.
- Aksi utama di **kanan atas halaman**, bukan di footer. Tidak ada sticky action bar.
  - Create: `Simpan` / `Simpan Draft` (`Button` primary).
  - View (Account): `Riwayat Perubahan <n>` — membuka `AuditLogsSidebar` (§4.6.2).
  - View (Item): `Kembali` (`Button` outline) — **tidak konsisten**, lihat §10.4.

### 7.2 Layout field

- Kartu `Card` (§4.2.2).
- Grid kolom **menyesuaikan entitas**: Account 2 kolom, Item 3 kolom, Fiscal Year 4 kolom. Field panjang (Catatan, Nama Item Lengkap) span penuh.
- Section di dalam kartu dipisah heading uppercase kecil: `KONFIGURASI TRANSAKSI & KONTROL AKUN`, `KONFIGURASI KARAKTERISTIK & PERLAKUAN ITEM`, `FOTO PRODUK / ITEM`.
- Untuk dokumen transaksi, section dipecah jadi **kartu terpisah** dengan ikon + judul + subtitle:
  `📖 Informasi Utama Jurnal (Header)` / `📚 Rincian Ayat Jurnal (Journal Lines)` + *"Entri pos akun pembukuan, debit, kredit, dan kontak partner"*.

### 7.3 Anatomi field

Spesifikasi kelas lengkap ada di **§4.3.1 (`Input`)**. Ringkasan operasional:

| Elemen | Nilai |
|---|---|
| Label | `text-[0.7rem] font-extrabold text-slate-500 uppercase tracking-widest px-1` → **8,4px @root 12px**, 9,8px @14px |
| Wajib | asterisk `*` rose setelah label |
| Input | tinggi **31,5px @root 12px** · 36,7px @14px · radius 9 / 10,5px |
| Ikon dalam field | di kiri; input diberi `pl-10` |
| Disabled / view | `bg-slate-100/80 border-slate-200 text-slate-500 cursor-not-allowed shadow-2xs select-none` |
| Focus | border `brand-yellow` + ring `brand-yellow/10` |
| Textarea | sama, `resize` aktif, tinggi ±80px |
| Checkbox | `Checkbox` (§4.3.2), grid 3–4 kolom, label di kanan, sentence case |

### 7.4 Combobox / FK picker

Lihat **§4.4** untuk sembilan varian dan kapan memakai yang mana. Yang dipakai ERP untuk FK akun/partner/item adalah `MasterCombobox` (§4.4.2), dengan panel portal §4.4.1.

Perilaku kunci: **hanya record aktif yang muncul** di daftar pilihan. Bank BCA (`NON AKTIF`) tidak tampil sebagai pilihan subkategori. Ini benar dan harus ditiru SIBA — dengan catatan §13.3.

### 7.5 Grid line item (Journals)

- Header kolom: `# | Akun Perkiraan (COA)* | Partner/Kontak | Mata Uang* | Kurs* | Trx Amount* | Debit (IDR)* | Kredit (IDR)* | Catatan/Memo`.
- Setiap sel adalah **kontrol** (`MasterCombobox` atau `Input` angka) berbingkai, bukan teks polos — tampilannya seragam dengan field form.
- Sel FK menampilkan dua baris: nama (bold) + kode mono di bawah — pola `MasterTableCell` (§4.2.4) di dalam kontrol.
- Placeholder informatif untuk sel opsional: `Tidak Perlu Partner`.
- Grid scroll horizontal dengan scrollbar tipis (`ScrollArea`, §4.2.5).
- Kosong → teks tengah `Belum ada baris transaksi jurnal.` + tombol `+ Tambah Transaksi Baris Baru` (`Button` outline, kiri).

### 7.6 Balance summary strip (sangat relevan untuk SIBA)

Tepat di bawah grid, masih di dalam kartu yang sama, strip berlatar tipis:

```
┌────────────────────────────────────────────────────────────────┐
│ ⚖  Status Keseimbangan (Debit – Kredit):  ✓ Seimbang (Balanced)│
│    Selisih Debit dikurangi Kredit: Rp 0                        │
│                          TOTAL DEBIT      TOTAL KREDIT         │
│                          Rp 17.800        Rp 17.800            │
└────────────────────────────────────────────────────────────────┘
```

- Seimbang → hijau (`emerald`) + ikon centang. Tidak seimbang → amber + ikon peringatan, teks `⚠ Belum Seimbang (Unbalanced)`.
- Total selalu `font-mono`, label uppercase kecil di atasnya.
- Live, dihitung ulang saat baris berubah.

### 7.7 Master-detail: Fiscal Year & Period

Satu halaman menampung dua level:

1. Kartu `Informasi Tahun Fiskal` — 4 kolom (Tahun Fiskal, Label Tahun, Tanggal Awal, Tanggal Akhir) + Catatan span penuh.
2. Kartu `Rincian Periode Fiskal (12 Bulan)` — tabel anak dengan kolom `AKSI (GEMBOK)`, ditambah **hint text rata kanan** di header section: *"Klik ikon gembok untuk mengunci / membuka masing-masing bulan periode."*

Lock/unlock per bulan dilakukan langsung dari baris tabel, bukan dari form terpisah.

### 7.8 Tab untuk koleksi anak (Master Item)

Di bawah kartu form utama, tab bar `flex border-b border-slate-200 gap-2 overflow-x-auto`:

```
[📚 Varian Item (2)] [⚖ Konversi Satuan (UoM) (1)] [🛒 Setup Pembelian / Vendor (0)] [🕘 Audit Log]
```

- Tab aktif: `border-b-2 border-brand-blue text-brand-blue font-bold`.
- Tab non-aktif: `border-transparent text-slate-500 hover:text-slate-800`.
- **Hitungan record ada di label tab** — pengguna tahu isi tab tanpa membukanya.
- Isi tab = kartu berjudul (`Daftar Spesifikasi & Varian Item`) berisi tabel sederhana bergaya `MasterTableCell` (§4.2.4).

### 7.9 Halaman scoped (Opening Balance)

Kartu konteks di paling atas sebelum kartu data:

```
┌──────────────────────────────────────────────────────────────┐
│ PILIH TAHUN FISKAL *          │ STATUS TAHUN FISKAL │ PERIODE AKTIF        │
│ [📅 TAHUN FISKAL 2 – 2027 ×⌄] │ [OPEN]              │ 2027-01-01 s/d 12-31 │
└──────────────────────────────────────────────────────────────┘
```

Satu kontrol editable (pemilih scope, `MasterCombobox`) + beberapa nilai turunan read-only sebagai chip/badge. Pola ini pas untuk halaman SIBA yang bergantung fiscal period / company.

---

## 8. Modal, drawer, overlay

Spesifikasi kelas ketiga komponen dasar ada di §4.5 (`Modal`, `StatusConfirmModal`, `Toast`) dan §4.6.2 (`AuditLogsSidebar`). Bagian ini mencatat **bagaimana ERP memakainya**.

### 8.1 Confirm modal di ERP

`StatusConfirmModal` (§4.5.2) dengan teks konsekuensi yang lebih panjang:

```
        ┌──────────────────────────┐
        │        ⚠ (tile rose)      │
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

Lebar terukur **288px** (`max-w-sm` @root 12px). Semua rata tengah (`text-center`), berbeda dari pola dialog kiri-ikon/kanan-tombol.

### 8.2 Drawer riwayat perubahan

`AuditLogsSidebar` (§4.6.2). Di ERP entri menampilkan **nama tabel teknis** (`acc_account`) — showcase sudah memakai nama manusiawi (`Master Item / Barang`). Diff level field muncul sebagai `Status Jurnal: Draft → Posted` dengan nilai lama diwarnai muted.

### 8.3 Riwayat inline (Journals) & tab (Item)

Entitas jurnal menampilkan riwayat sebagai **section di dasar halaman** dengan tombol `Collapse All` dan per-entri `Sembunyikan`. Master Item menampilkannya sebagai **tab** `Audit Log`. Akun menampilkannya sebagai **drawer**.

→ Tiga penempatan berbeda untuk fungsi yang sama. Lihat §10.3.

### 8.4 Yang ada di komponen tapi tidak dipakai ERP

| Komponen | Status di ERP |
|---|---|
| `Toast` (§4.5.3) | **tidak dipakai** — tidak ada notifikasi sukses/gagal sama sekali |
| `Switch` (§4.3.3) | tidak dipakai di master (diganti badge-toggle) |
| Search global di header (§2.4) | ada di showcase, tidak ada di ERP |

### 8.5 Yang benar-benar tidak ada

Tidak ada skeleton loader (hanya fade-in opacity + `translate` saat mount, kelas `animate-in fade-in zoom-in-95 duration-150`), tidak ada command palette, tidak ada shortcut keyboard.

---

## 9. State & pola presentasi lain

| State | Perlakuan |
|---|---|
| **Empty (bisa diisi user)** | teks tengah `Belum ada baris transaksi jurnal.` + tombol tambah |
| **Empty (diisi proses lain)** | dua baris: `Belum ada data saldo awal (Opening Balance) yang tercatat untuk tahun fiskal ini.` + baris kecil `Data opening balance dibuat melalui proses migrasi awal atau penutupan buku tahun fiskal sebelumnya.` — **tanpa CTA**, karena user memang tidak bisa membuatnya di sini |
| **Empty (lampiran)** | kartu inline berbingkai: ikon gambar + `Belum ada foto item yang diunggah.` |
| **Counter** | teks kecil rata kanan di header section: `Total 0 baris akun terdaftar`; atau badge hitungan di footer picker (`Total 4 data`) |
| **Loading** | `Button` punya state `loading` (spinner); halaman memakai animasi opacity/translate saat mount; tidak ada skeleton |
| **Soft delete** | tidak ada aksi hapus di list; status badge dapat diklik (`title="Klik untuk mengubah status"`) → `StatusConfirmModal` → aktif/non-aktif |
| **Validasi** | hanya `required` HTML native di ERP; komponen `Input` **punya** state error + pesan inline (§4.3.1) tetapi belum dipakai ERP |
| **Akses ditolak** | `MenuAccessGuard` (§4.6.6) — hanya state "diizinkan" yang terdokumentasi |

---

## 10. Inkonsistensi & hal yang jangan ditiru

### Dari modul ERP

1. **Skala terlalu kecil di layar umum.** Root 12px pada <1440px → label form 8,4px, teks tabel 9–10px. Untuk aplikasi akuntansi yang dipakai berjam-jam ini melelahkan. Ide root responsif-nya bagus; titik awalnya yang salah (§3.1).
2. **View mode = input ter-disable.** Semua field detail digambar sebagai input abu yang tidak bisa diklik. Ini menyampaikan "rusak/terkunci", bukan "read-only". Nilai read-only sebaiknya disajikan sebagai teks.
3. **Audit trail di tiga tempat** (drawer / section inline / tab) tergantung entitas.
4. **Aksi header form tidak konsisten:** Account view → `Riwayat Perubahan`; Item view → `Kembali`; keduanya sudah punya tombol back di kiri.
5. **Tidak ada validasi inline** — padahal `Input` mendukungnya. Klik `Simpan` dengan form kosong tidak menghasilkan feedback yang terlihat.
6. **Filter ganda yang redundan:** baris filter per kolom **dan** panel Filter Form berisi field yang sama persis.
7. **Casing label tidak konsisten:** header tabel uppercase, label Filter Form sentence case, label form uppercase.
8. **Dua opasitas scrim:** modal 60%, drawer 40%.
9. **Terlalu banyak badge solid jenuh** di kolom `PROPERTI ITEM` (5 chip penuh warna dalam satu sel) — mata tidak punya tempat istirahat.
10. **Nol dukungan keyboard.** `Esc` tidak menutup dropdown maupun drawer; tidak ada shortcut. Hanya `Switch` yang punya `role`/`aria-*` yang benar; sisanya mengandalkan `title` saja.
11. **Panel submenu melayang di atas konten** dan menutup sendiri tanpa aba-aba saat berpindah halaman.
12. **Top bar ERP kosong** — tidak ada company switcher dan tidak ada search global, padahal komponen search-nya sudah ada di showcase.

### Dari component library

13. **Token warna belum benar-benar tunggal.** Empat gejala:
    - `Badge` varian `warning` dan `yellow` memakai background identik (`brand-yellow`), hanya beda warna teks.
    - Badge role di dropdown profil memakai `bg-blue-50 text-blue-700 border-blue-200/60` yang **bukan** salah satu dari 7 varian baku.
    - `StatusConfirmModal` menimpa tombol dengan `!bg-rose-600` alih-alih memakai varian `danger` yang sudah ada (`bg-rose-500`).
    - Tiga intensitas untuk satu makna "terpilih": `bg-brand-yellow/15` (dropdown), `bg-brand-yellow/10` (modal picker), `bg-amber-50/40` (ReferencePicker).

    Ditambah dua bahasa fokus (`Input` → kuning, filter `DataTable` → biru) dan dua warna label (`text-slate-500` vs `text-brand-blue/40`).

14. **Hitungan komponen tidak sinkron.** Hero berbunyi "27 komponen", badge navbar & rail berbunyi "30".

15. **Dokumentasi tanpa props.** Setiap blok `CONTOH BARIS KODE` hanya berisi `import X from '@/components/X';` + `<X />`. Tidak satu pun properti didokumentasikan — playground menunjukkan *bahwa* varian ada, tapi bukan *bagaimana* memanggilnya. Untuk katalog yang mengklaim "PRODUCTION READY", ini kekurangan terbesarnya.

16. **Tiga demo tidak lengkap / rusak:**
    - `UserProfileModal` hanya merender scrim transparan, tanpa panel.
    - `MenuAccessGuard` hanya mendemokan state "diizinkan"; state "ditolak" — yang justru perlu dirancang — tidak ada.
    - `ChatWidget` tidak punya demo di kartunya; pengguna diarahkan mengklik FAB global.
    - `Toast` varian `warning` merender `class="… rounded-full undefined opacity-20"` — peta warna kehilangan kunci `warning`, sehingga pita aksen dan progress bar tak berwarna. Tiga varian lain (`success`, `error`, `info`) normal.

17. **`Toast` ada tapi tidak dipakai ERP.** Komponen berfungsi penuh (4 tipe, timer, glassmorphism) namun tidak ada satu pun notifikasi di aplikasi nyata.

18. **`AuditLogsSidebar` belum menyerap format diff panah.** ERP menampilkan `Status Jurnal: Draft → Posted`; komponen hanya menampilkan `Field: nilai`.

19. **Skala z-index liar.** Nilai melompat dari `z-30` ke `z-[999999]` tanpa tingkatan bernama (lihat tabel §4.7). Akibat nyata: `Toast` (`z-[1000]`, `right-10 bottom-10`) menutupi `ChatWidget` FAB (`z-50`, `right-6 bottom-6`).

20. **`ActionView` tidak dibangun di atas `Button`** sementara `ActionEdit`/`ActionDelete` iya → padding ketiganya berbeda. Deskripsi `ActionEdit` juga menyebut "kuning/amber" padahal kelasnya `blue-400`.

21. **Kelas tidak valid lolos ke produksi:** `py-0.2` pada badge tooltip rail tidak ada di skala spacing Tailwind dan tidak menghasilkan padding.

---

## 11. Gap analysis terhadap `siba30_master_mockup.html`

### 11.1 Perbandingan token

| Aspek | SIBA saat ini | Akui Proto | Putusan |
|---|---|---|---|
| Base font | 13,5px tetap | 12 / 14 / 16px responsif (efektif label 8,4–11,2px) | **Adopsi mekanisme, bukan nilainya** — buat root responsif **14 / 15 / 16px** |
| Font family | system-ui stack | Plus Jakarta Sans + JetBrains Mono | **Adopsi sebagian** — tambahkan font mono yang lebih tegas; UI font boleh tetap system stack |
| Primary | `#2C7BE5` biru terang | `#3E495A` slate-blue + aksen kuning `#DBC360` | **Pertahankan SIBA** (biru lebih netral untuk ERP), tapi turunkan saturasi warna aksen di rail |
| Teks di atas primary | `#FFF` | `#FFFAFA` (`snow`) | Sepele, boleh diadopsi — putih hangat lebih lembut di layar |
| Radius | 5 / 7 / 10px | 4,5 / 9 / 12 / 18px (@12px) | **Naikkan sedikit** → 6 / 9 / 12px. Radius SIBA saat ini terasa kaku |
| Card padding | 16px | 12–18px (`p-4 sm:p-6`) | Setara, pertahankan |
| Tinggi baris tabel | ~35px | 38px | Setara, pertahankan |
| Chip/badge | pill pastel + dot, border sewarna | solid jenuh, teks putih, `rounded-md` | **Pertahankan SIBA** untuk atribut jamak; **adopsi varian `neutral`** mereka sebagai code chip |
| Shadow | halus (`0 1px 2px`) | berlapis: `2xs` untuk kontrol, `sm` kartu, `2xl` overlay | **Adopsi tangganya** — terutama `shadow-2xs` pada input & `shadow-2xl` pada overlay |
| Micro-interaction | tidak ada | `hover:scale-[1.02]` / `active:scale-[0.98]` | **ADOPSI** — murah, terasa responsif |

### 11.2 Perbandingan pola

| Pola | SIBA saat ini | Akui Proto | Putusan |
|---|---|---|---|
| Rail modul | docked 212px berlabel teks | floating 48px ikon + tooltip berbadge hitungan | **Pertahankan SIBA** — label teks lebih jelas untuk 6+ modul; **adopsi tooltip berbadge** |
| Sub sidebar | docked 238px | floating ±250px, bisa collapse, **punya search** | **Adopsi tombol collapse + search** |
| Search list | satu input global di toolbar | + baris filter per kolom | **ADOPSI** baris filter per kolom |
| Filter kolom | dropdown per kolom ref/enum di toolbar | input filter di header + panel Filter Form | **ADOPSI** versi header; **jangan** duplikasi panel |
| Aksi baris | kebab menu muncul saat hover | `ActionView` / `ActionEdit` selalu terlihat | **Hybrid** — ikon lihat/ubah selalu terlihat, sisanya di kebab |
| Hapus | delete guard + konfirmasi | tidak ada hapus; toggle status via badge | **ADOPSI** toggle status untuk master; pertahankan delete guard SIBA untuk data yang memang boleh dihapus |
| Sel referensi | `nama · KODE` sebaris | `MasterTableCell` 2-baris | **ADOPSI** |
| COA | tabel datar per level | tree view interaktif | **ADOPSI** — tambahkan tree sebagai view utama Account |
| Detail/edit | satu komponen, tab Informasi / Data Terkait / Record JSON | route `update?mode=view\|edit` | Setara. **Adopsi query param `mode`** agar URL bisa di-share |
| Tab anak | ada (Data Terkait) | ada + **hitungan di label tab** | **ADOPSI** hitungan di label |
| Panel kanan | audit trail + "Dipakai oleh" (296px) | drawer 336–384px / inline / tab | **Pertahankan SIBA**, tapi seragamkan: satu tempat saja |
| Diff audit | daftar perubahan | ERP: `Field: lama → baru`; komponen: `Field: nilai` | **ADOPSI format panah** (versi ERP) |
| Nested audit | belum ada | perubahan tabel anak bersarang di entri induk | **ADOPSI** — satu aksi user = satu entri |
| Aksi simpan | (belum ada footer bar tetap) | tombol di page header | **ADOPSI** tombol utama di page header + tambahkan sticky footer bar saat form kotor (dirty) |
| Validasi | `.err` inline sudah ada | komponen mendukung, aplikasi tidak memakai | **Pertahankan SIBA** — ini keunggulan |
| Dropdown FK | `<select>` native terfilter | 9 komponen picker berjenjang, portal + search + code chip, hanya record aktif | **ADOPSI** — minimal 3 tingkat: Combobox / ModalPicker / ReferencePicker |
| Date input | `<input type=date>` | `DatePicker` popover + `DatePickerModal` + `DateRangePicker` | **ADOPSI** — popover untuk filter (apply seketika), modal untuk field data (`Terapkan`) |
| Line item grid | belum ada | ada, sel berupa kontrol | **ADOPSI** untuk `acc_journal_line` |
| Balance strip | belum ada | ada, live | **ADOPSI** |
| Empty state | ikon + judul + teks + CTA | dua baris, CTA hanya bila relevan | **ADOPSI** varian tanpa-CTA untuk data yang dihasilkan proses |
| Toast | ada | komponen ada, aplikasi tidak memakai | **Pertahankan SIBA**; adopsi **progress-bar timer** & **pita aksen kiri** mereka |
| Switch | ada | ada, satu-satunya komponen ber-`aria` benar | Setara; **pertahankan pembagian** Switch=pengaturan, badge-toggle=master |
| Command palette / shortcut | Ctrl+K, `/`, `N`, `Esc` | tidak ada | **Pertahankan SIBA** |
| Company switcher | ada di topbar | tidak ada | **Pertahankan SIBA** |
| Modal | 460px, ikon kiri + tombol kanan-bawah | `Modal` `max-w-md` + `StatusConfirmModal` 288px rata tengah | **Adopsi chip subjek + tile ikon + teks konsekuensi**; pertahankan layout SIBA |
| Style guide internal | belum ada | halaman `/components` dengan playground per komponen | **ADOPSI konsepnya** (lihat §12 no. 18) |

---

## 12. Daftar perubahan yang disarankan untuk mock-up

### Prioritas 1 — dampak besar, effort kecil

1. **Baris filter per kolom** di `thead` tabel `.grid`. Tambah `<tr class="filterrow">` dengan input mungil per kolom yang punya `filterable:true` di entity registry. Label kolom pertama: `FILTER`, placeholder menyebut nama kolom.
2. **Sel referensi dua baris** (`MasterTableCell`). Ubah `.ref-cell` dari `nama · KODE` sebaris menjadi nama bold di atas + kode mono `11px` `text-slate-400` di bawah. Jangan lupa `min-w-0` + `truncate`.
3. **Chip subjek + tile ikon + teks konsekuensi di modal konfirmasi.** Tambahkan `<span class="tag mono">KODE (Nama)</span>` dan kalimat yang menjelaskan akibat tindakan.
4. **Diff panah di audit trail:** `Status: Draft → Posted` dengan nilai lama muted.
5. **Hitungan record di label tab** `Data Terkait (3)` — dan di node tree, dan di tooltip rail.
6. **Naikkan radius** token: `--r-sm:6px; --r:9px; --r-lg:12px`.
7. **Micro-interaction tombol:** `hover:scale-[1.02]` + `active:scale-[0.98]` + `transition-all duration-200`.
8. **Tangga shadow:** `2xs` (hairline) untuk input & tombol outline, `sm` untuk kartu, `2xl` untuk overlay.

### Prioritas 2 — pola baru untuk modul berikutnya

9. **Tree view COA.** Halaman `acc_account` jadi tree Category → Subcategory → Account → Sub-account, dengan `Buka Semua` / `Tutup Semua`, search lintas level, hitungan anak di kanan node, dan chip tipe node. Sediakan toggle Tree/Tabel.
10. **Grid line item + balance strip** untuk `acc_journal`. Strip menampilkan status seimbang, selisih, total debit, total kredit — dihitung live. Amber saat belum seimbang, hijau saat seimbang. Blokir posting selama belum seimbang.
11. **Keluarga picker berjenjang.** Ganti `<select>` untuk FK dengan minimal tiga komponen:
    - `Combobox` (portal + search, opsi `[chip kode] – nama`) untuk FK sederhana;
    - `SearchableModalPicker` (modal + search + pagination, opsi 2 baris) untuk data banyak;
    - `ReferencePicker` (field + tombol `Select` → modal kaya berisi status/vendor/tanggal/nominal) untuk FK **dokumen transaksi**.

    Semuanya: **hanya record `is_active = true`** yang tampil (kecuali nilai yang sedang terpasang).
12. **Date picker ganda.** Popover (apply seketika) untuk filter; modal ber-`Terapkan` untuk field yang mengubah data. Kalender: bulan & tahun sebagai tombol yang bisa dibuka, bukan panah saja; hari ini = outline, terpilih = fill.
13. **Kartu konteks scope** di halaman yang bergantung fiscal year / company (Opening Balance, Journal list, laporan): satu pemilih editable + chip turunan read-only.
14. **Status badge sebagai toggle** untuk seluruh master: klik badge → modal konfirmasi aktif/non-aktif. Sejalan dengan keputusan "delete guard" yang sudah ada — data ber-referensi tidak dihapus, cukup dinonaktifkan.
15. **Nested audit entry:** perubahan pada tabel anak bersarang di dalam entri induk (`pl-3 border-l-2`), bukan sebagai entri terpisah.

### Prioritas 3 — konsistensi & poles

16. **Satu tempat untuk audit trail.** Pertahankan panel kanan 296px di SIBA untuk semua entitas; jangan tiru tiga penempatan Akui.
17. **Sticky action bar** saat form dirty (`Simpan` / `Batal` + indikator "perubahan belum disimpan"), melengkapi tombol utama di page header.
18. **Halaman style guide internal** meniru `/components`: satu kartu per komponen berisi nama, path file, badge kategori, deskripsi, playground, dan contoh kode — **tetapi dengan tabel props**, yang justru tidak dimiliki Akui (§10.15).
19. **Skala z-index bernama** sebelum meniru overlay mereka: `--z-header:100; --z-rail:200; --z-drawer:300; --z-modal:400; --z-popover:500; --z-toast:600`.
20. **Hint text rata kanan** di header section untuk tabel anak yang punya aksi tidak jelas (mis. "Klik ikon gembok untuk mengunci periode").
21. **Empty state dua varian:** dengan CTA (user bisa membuat) dan tanpa CTA + kalimat penjelas asal data (dihasilkan proses lain).
22. **Tombol collapse + search** pada sub-sidebar, memperlebar area konten untuk tabel lebar.
23. **Font mono yang lebih tegas** (JetBrains Mono / IBM Plex Mono) untuk kode, tanggal, dan angka; SIBA sudah memakai mono tapi lewat stack sistem.
24. **Kartu info inline** (`bg-blue-50/60 border-blue-100 text-brand-blue rounded-xl`) untuk menjelaskan aturan bisnis di dalam form.
25. **Toast:** adopsi progress-bar timer di dasar kartu dan pita aksen vertikal di kiri; jangan tiru glassmorphism-nya bila kontras jadi turun.

### Tidak diadopsi (keputusan sadar)

- Skala root yang dimulai dari 12px dan label 8,4px.
- View mode berupa input ter-disable.
- Badge solid jenuh untuk atribut jamak.
- Panel Filter Form yang menduplikasi baris filter kolom.
- Menghapus shortcut keyboard dan command palette.
- Rail ikon tanpa label teks.
- Dua bahasa warna fokus (kuning untuk input, biru untuk filter) — pilih satu.
- Katalog komponen tanpa dokumentasi props.

---

## 13. Pertanyaan terbuka

1. **Tree vs tabel untuk COA:** apakah tree menggantikan tabel Account, atau berdampingan sebagai toggle? Tree lebih baik untuk memahami struktur, tabel lebih baik untuk bulk-scan dan filter kolom.
2. **Toggle status vs hapus:** apakah SIBA mengadopsi kebijakan "master tidak pernah dihapus, hanya dinonaktifkan"? Ini keputusan data, bukan UI — memengaruhi DBML (`is_active` wajib di semua master) dan delete guard yang sudah dibuat.
3. **Filter aktif pada dropdown FK:** ketika sebuah record dinonaktifkan padahal masih terpasang di transaksi lama, bagaimana form edit menampilkannya? Akui Proto menyembunyikannya dari daftar pilihan — perlu perlakuan khusus untuk nilai eksisting.
4. **Bahasa:** Akui Proto mencampur Indonesia dan Inggris dengan pola yang sama seperti SIBA (istilah teknis tetap Inggris; nama hari/bulan Indonesia; nilai tanggal ISO). Konvensi ini bisa dikunci.
5. **Root responsif:** apakah SIBA mengadopsi root font-size tiga langkah? Keuntungannya nyata di monitor besar, tetapi menambah beban QA (setiap layar harus dicek di tiga skala) dan membuat semua angka px dalam dokumentasi menjadi kondisional.
6. **Berapa tingkat picker yang benar-benar dibutuhkan SIBA?** Akui punya 9. Tiga (Combobox / ModalPicker / ReferencePicker) mungkin cukup; apakah `MultiCombobox` dan `SearchableList` punya kasus pakai nyata di SIBA?
7. **Di mana tanggung jawab notifikasi?** Akui punya `Toast` yang tidak dipakai karena tidak ada lapisan feedback yang disepakati. SIBA perlu memutuskan lebih dulu: aksi mana yang memunculkan toast, mana yang cukup mengubah state di layar.

---

## 14. Sumber

### Component Showcase — `sso.prototype-akui.online` (15 September 2026)

- `/components`, mode **Semua di Kategori Ini** untuk ketujuh rail: Semua Komponen (30), Buttons & Actions (4), Data Display & Badges (5), Form Controls & Inputs (3), Selects & Pickers (9), Feedback & Dialogs (3), Navigation & Layout (6).
- Seluruh 30 kartu komponen dirender serentak; markup & `getComputedStyle` diambil dari DOM langsung.
- Overlay diukur dalam keadaan terbuka: dropdown portal `MasterCombobox`, kalender `DatePicker`, modal `Modal` / `SearchableModalPicker` / `ReferencePicker` / `DatePickerModal` / `StatusConfirmModal`, drawer `AuditLogsSidebar`, keempat varian `Toast`, dropdown `UserProfileNavbarItem`.
- Skala root diuji pada viewport 1024 / 1280 / 1400 / 1440 / 1600 / 1792 / 1920 px.

### Aplikasi ERP — `erp.prototype-akui.online` (13 September 2026)

- `/modules/erp/masters/partners`
- `/modules/erp/masters/items` (+ `update?id=5&mode=view`)
- `/modules/erp/accounting/chart-of-accounts/category`
- `/modules/erp/accounting/chart-of-accounts/account` (+ `add`, `update?id=1&mode=view`)
- `/modules/erp/accounting/journals` (+ `add`, `update?id=2&mode=view`)
- `/modules/erp/accounting/period-and-balance/fiscal-period` (+ detail)
- `/modules/erp/accounting/period-and-balance/opening-balance`

### Pembanding lokal

- `SIBA Mock Up Design/siba30_master_mockup.html`
- `Konsep SIBA 3.0 v3.md`, `SIBA 3.0 DBML.txt`

### Catatan revisi

Versi 15 September 2026 menambahkan §4 (katalog 30 komponen), merevisi §3.1 (root responsif — koreksi terhadap klaim "12px tetap"), merekonsiliasi tinggi input di §7.3, memperluas §10 dengan sembilan temuan dari component library (no. 13–21), dan menambah §12 no. 7–8, 11–12, 15, 18–19, 24–25. Penomoran section bergeser: §4–12 lama kini menjadi §5–13.
