-- A Penambahan now raises an existing open item, the way a Debit Note raises
-- the invoice it references, instead of opening a new item, so no line opens
-- an item to record. The column was written only by a Tambah posted under the
-- previous rule; the item it named keeps its own source document, so nothing
-- that reads the book loses anything.
DROP INDEX "fin_item_adjustment_line_opened_item_id_idx";
ALTER TABLE "fin_item_adjustment_line" DROP COLUMN "opened_item_id";
