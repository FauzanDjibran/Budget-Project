-- A Transaction Purpose's label is computed, so it stops being stored.
--
-- Every label now reads `<Penerimaan|Pengeluaran> <Budget Category> <dari|ke>
-- <Partner Category>`, composed from the three columns that remain. Storing it
-- as well would let the two disagree: renaming a Budget Category would leave
-- its Purposes reading the old name, with nothing to notice.
--
-- What this deliberately discards is the hand-written wording the original 22
-- carried — "Pemberian Advance kepada Karyawan" becomes "Pengeluaran Piutang ke
-- Karyawan". That wording named the business event rather than the
-- classification, which is what made it worth keeping until now; uniformity was
-- chosen over it, so the column has nothing left to hold.
--
-- Nothing downstream reads this column. A Cash Bank Book entry and a journal
-- line record the label they were written with as ordinary text in their own
-- `note` and `description`, so every posted document keeps the wording it had
-- at the time regardless of what happens here.

ALTER TABLE "sys_purpose" DROP COLUMN "label";
