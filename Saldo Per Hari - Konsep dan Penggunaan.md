# Saldo Per Hari: Konsep dan Cara Penggunaan

> SIBA 3.0 · berlaku sejak 20/10/2026 · commit `60332f9`, `72dd756`, `8fb48c9`, `0cb0873`
> Aturan resminya: CLAUDE.md §10 rule 106 dan §12 *"A document may be backdated, never dated ahead"*.
> Knowledge base: `accounting/books-and-posting` 3.1 §3.4 dan `accounting/subject-books` 2.0 §2.6.

## 1. Ringkasnya

Dokumen boleh diberi Tanggal Dokumen mundur (backdate) selama tahun bukunya masih Open.
Sejak update ini ada satu aturan tambahan:

> **Saldo tidak boleh di bawah nol pada hari mana pun, dihitung dari tanggal dokumen sampai hari ini.**

Aturan ini berlaku untuk dua hal:

| Yang dijaga | Artinya |
| --- | --- |
| **Saldo Cash & Bank** | Pembayaran yang di-backdate harus tertutup oleh saldo pada tanggalnya **dan** pada setiap hari sesudahnya. |
| **Open item buku subjek** (Titipan, Hutang, Piutang, …) | Pelunasan yang di-backdate tidak boleh membuat item minus pada hari mana pun. Akibatnya, item **tidak bisa dilunasi sebelum tanggal ia dibuka**. |

### Mengapa

Sebelumnya, pembayaran hanya dicek terhadap saldo **saat Post**. Pembayaran yang di-backdate ke tanggal ketika uangnya belum masuk tetap lolos, padahal laporan untuk tanggal-tanggal di antaranya jadi menunjukkan saldo minus. Rekening bank sungguhan tidak pernah begitu, dan Partner tidak pernah berutang negatif.

**Contoh (kasus 03 Jan):**

| Tanggal | Mutasi | Saldo |
| --- | --- | --- |
| 01/01 | Masuk 100 | 100 |
| 05/01 | Keluar 80 | 20 |
| 20/01 | Masuk 200 | 220 |

Pembayaran 50 bertanggal **03/01** dulu lolos, karena saldo akhir 220 cukup. Padahal saldo tanggal 05/01 jadi 20 − 50 = **−30**. Sekarang pembayaran itu ditolak:

> Saldo Cash & Bank tidak mencukupi pada 05/01/2020: tersedia 20, dibutuhkan 50. Transaksi dibatalkan.

Pembayaran 20 pada tanggal yang sama tetap lolos.

## 2. Cara penggunaan (untuk pengguna)

### 2.1 Kapan pengecekan terjadi

| Dokumen | Saat **Simpan** draft | Saat membuka konfirmasi **Post** | Saat **Post** |
| --- | --- | --- | --- |
| Realisasi Pengeluaran / Penerimaan | Open item dicek. Strip saldo menampilkan **Kekurangan** jika saldo kurang. | Cash & Bank dicek per hari | Keduanya dicek ulang |
| Cash Bank Transfer (Transfer, Pencairan, Pembelian Valas) | — | Sumber dicek per hari | Dicek ulang |
| Pencairan Open Item | Open item dicek | Cash & Bank dan item dicek | Dicek ulang |
| Penyesuaian Open Item (Pengurangan) | Open item dicek | Dicek | Dicek ulang |
| Reklasifikasi Open Item | Open item dicek | Dicek | Dicek ulang |
| Konfirmasi Funding Request (induk) | — | Rekening induk dicek per hari | Dicek ulang |

Uang **masuk** (Penerimaan, tujuan transfer) tidak pernah ditolak oleh aturan ini, karena tidak bisa membuat saldo minus. Uang masuk yang di-backdate justru menaikkan saldo semua hari sesudahnya.

### 2.2 Bentuk penolakan di layar

Pada konfirmasi Post, penolakan muncul **di dalam dialog**, sebelum tombol ditekan. Tombol **Ya, Post** tidak bisa ditekan:

> Saldo Cash & Bank tidak mencukupi pada bulan 10/2026: tersedia 16.900.000, dibutuhkan 30.000.000. Transaksi dibatalkan.

- **"pada dd/mm/yyyy"**: hari di bulan dokumen itu sendiri yang akan minus.
- **"pada bulan mm/yyyy"**: ada titik di bulan **sesudahnya** yang akan minus. Biasanya karena sudah ada pembayaran besar bertanggal lebih baru.

Untuk open item:

> Open item SBI-0012 tinggal 0 pada 02/03/2026, tidak cukup untuk 5.000.000. Posisi tidak boleh di bawah nol pada hari mana pun — ubah tanggal dokumen atau kurangi nominalnya.

### 2.3 Apa yang harus dilakukan bila ditolak

1. **Periksa tanggalnya.** Apakah dokumen memang terjadi pada tanggal itu? Jika uangnya baru masuk sesudah tanggal tersebut, majukan Tanggal Dokumen ke hari setelah uang masuk.
2. **Posting dulu uang masuknya.** Jika penerimaan yang menutup pembayaran ini belum diinput, input dan Post penerimaan itu lebih dulu, dengan tanggal aslinya. Setelah itu pembayaran yang di-backdate akan lolos (lihat tes "backdated money in lifts every later month").
3. **Kurangi nominal atau pecah dokumen**, jika memang hanya sebagian yang tertutup pada tanggal itu.
4. **Untuk open item:** pilih item yang sudah dibuka pada tanggal tersebut, atau majukan tanggal pelunasan sampai sesudah item dibuka.

### 2.4 Yang tidak berubah

- Dokumen tetap tidak boleh bertanggal **setelah hari ini**, dan harus berada dalam tahun buku yang masih Open untuk setiap Company yang ditulisinya.
- Strip saldo di atas line (**Saldo Saat Ini · Total Digunakan · Sisa/Kekurangan**) tetap menunjukkan saldo **saat ini**. Untuk dokumen backdate, Sisa bisa terlihat cukup padahal hari yang lebih lama kurang. Penentunya adalah pesan di konfirmasi Post.
- Rekening valas: pembayaran **boleh** memakai layer kurs yang diperoleh sesudah tanggal dokumennya, selama rekening punya cukup uang pada hari itu.
- Selisih kurs dinilai saat Post, bukan menurut tanggal dokumen (keputusan "opsi B").

## 3. Cara kerjanya (untuk developer)

### 3.1 Cash & Bank: rantai bulan `cash_bank_period`

Satu baris per rekening per bulan (`cash_bank_id`, `period` = tanggal 1):

| Kolom | Isi |
| --- | --- |
| `opening`, `total_in`, `total_out`, `closing` | Dalam mata uang rekening. `closing = opening + in − out`, dan `opening` bulan berikutnya = `closing` bulan ini. |
| `min_balance` | **Titik terendah** saldo sepanjang bulan itu, termasuk opening. |
| `base_*` | Empat angka yang sama dalam IDR, untuk laporan. Tidak divalidasi: Revaluasi Kurs hanya menggerakkan base. |

Rantainya **tanpa bolong** dari bulan entri pertama sampai bulan entri terakhir. Mutasi bertanggal di luar rantai memperpanjangnya lebih dulu (`ensurePeriod`): ke belakang dengan nilai nol, atau ke depan membawa closing terakhir.

**Pengecekan satu mutasi** (`checkMovement` di `src/lib/siba/cash-bank.ts`):

1. Baca bulan milik entri itu saja. Mulai dari `opening`, putar ulang entrinya urut `(entry_date, id)`, dengan mutasi baru diletakkan **paling akhir pada harinya**. Titik terendah dari harinya dan seterusnya tidak boleh minus.
2. Semua bulan sesudahnya bergeser sebesar mutasi itu, jadi cukup satu agregat: `MIN(min_balance) + mutasi ≥ 0`.
3. Jika lolos, `movePeriods` menulis bulan itu dan menggeser `opening`/`closing`/`min_balance` semua bulan sesudahnya.

Biayanya: satu bulan entri dan satu agregat, **tidak pernah** membaca buku dari awal.

**Lock**: `lockCashBanks` mengambil advisory lock per rekening, **urut id**, supaya transfer A→B dan B→A yang di-Post bersamaan tidak saling menunggu. Urutan lock dalam satu posting: periode fiskal → posisi buku subjek → Cash & Bank.

**Preview**: `cashBankShortfall` menjalankan pengecekan yang sama tanpa lock dan tanpa menulis. Konfirmasi Post Realisasi dan Funding memakainya. Transfer, Pencairan Open Item dan Penyesuaian menjalankan posting aslinya lalu rollback (dry run), jadi otomatis kena pengecekan yang sama. Preview hanya peringatan dini: posting lain di antara preview dan Post tetap bisa membuat Post ditolak.

### 3.2 Open item: `itemLowestFrom`

Sebuah item punya sedikit entri, jadi entrinya dibaca utuh tanpa rantai bulan. Pelunasan bertanggal `d` dicek terhadap saldo terendah item dari `d` sampai hari ini (`itemLowestFrom` di `subledger.ts`), dengan mutasi diletakkan paling akhir pada harinya. Sebelum dibuka, item bernilai nol, sehingga pelunasan sebelum tanggal buka pasti ditolak. Pengecekan dijalankan saat simpan dan sekali lagi di dalam `recordSubledgerEntry`, di bawah `lockSubledgerPosition`. Penambahan (raise) tidak dicek.

### 3.3 Laporan

Buku Kas & Bank dan Saldo Kas & Bank mengambil saldo awal periode dari `cash_bank_period`: closing bulan sebelumnya ditambah entri bulan berjalan sebelum tanggal `from`. Hasilnya sama persis dengan scan penuh (dites di `tests/cash-bank.test.ts`). Laporan buku tidak menampilkan saldo berjalan, karena entri backdate bisa masuk di antara entri yang ditulis lebih dulu.

## 4. Operasional

| Perintah | Guna |
| --- | --- |
| `npm run db:reconcile` | **Cek 19**: rantai bulan setiap rekening dihitung ulang dari ledger dan dibandingkan dengan `cash_bank_period`. Ketahuan bila ada bulan bolong, bulan berlebih, angka beda di salah satu ukuran, atau `min_balance` di bawah nol. **Cek 12** adalah padanannya untuk open item. Read-only, aman dijalankan ke Neon: `node scripts/with-remote.mjs node --import tsx scripts/reconcile-books.ts`. |
| `npm run db:truncate-transactions` | Ikut mengosongkan `cash_bank_period`. |
| Migration `20261020094548_cash_bank_period` | Membangun rantai dari ledger yang sudah ada (backfill), jadi aman dipasang pada database berisi data. Sudah terpasang di Neon. |

Tidak ada `rebuildCashBankPeriods`, dan itu disengaja: cek 19 sudah menjadi pengamannya. Bila suatu saat cek 19 gagal, rantainya bisa dibangun ulang dengan SQL backfill dari migration di atas, setelah baris lamanya dihapus.

## 5. Bukti yang sudah dijalankan (20/10/2026)

- `npm test`: 1030 lolos, termasuk kasus 03 Jan, kasus Februari, rantai yang memanjang ke belakang, uang masuk backdate, dua transfer bersilang yang di-Post bersamaan, item yang dilunasi sebelum dibuka, dan preview Realisasi / Transfer / Pencairan yang menolak kekurangan backdate.
- `db:reconcile` 19/19 di lokal (setelah reset + showcase setahun) dan di Neon. Data showcase setahun di-Post urut tanggal lewat engine asli tanpa satu pun penolakan.
- Cek 19 dibuktikan dengan enam kesalahan yang sengaja ditanam di dalam transaksi yang di-rollback. Semuanya tertangkap.
- Browser: konfirmasi Post RBK-0008 yang kekurangan saldo menampilkan penolakan di dialog, dan tombol **Ya, Post** tidak bisa ditekan.

## 6. Batasan yang diterima

- **Strip saldo** menunjukkan saldo hari ini, bukan saldo per tanggal dokumen (§2.4).
- **Preview tanpa lock** bisa lolos lalu Post ditolak, jika ada posting lain di antaranya.
- **Neon belum berisi dokumen ter-Post**, jadi di sana cek 19 baru membuktikan entri saldo awal.
- **Nomor journal** berurut menurut waktu ditulis, sehingga `JRN-0102` bisa bertanggal lebih awal dari `JRN-0101`.
