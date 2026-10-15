-- A Penyesuaian Open Item line now names one open item and the value it should
-- hold. The user types the new value; the difference, and so whether the line
-- is a Penambahan or a Pengurangan, is worked out from what the item held. The
-- effect therefore moves from the header to the line, where it is derived
-- rather than chosen, and one document may raise some items and lower others.

ALTER TABLE "fin_item_adjustment_line"
  ADD COLUMN "sub_ledger_balance_id" INTEGER,
  ADD COLUMN "effect" "ItemAdjustmentEffect",
  ADD COLUMN "balance_before" DECIMAL(18,2),
  ADD COLUMN "new_amount" DECIMAL(18,2);

UPDATE "fin_item_adjustment_line" l
   SET "effect" = a."effect"
  FROM "fin_item_adjustment" a
 WHERE a."id" = l."adjustment_id";

-- Every item a line used to name becomes a line of its own, carrying the
-- amount and base it moved by. What the item held before and the value typed
-- were never recorded, so both stay null on these rows.
INSERT INTO "fin_item_adjustment_line"
  ("adjustment_id", "sequence_no", "description", "sub_ledger_balance_id", "effect",
   "amount", "base_amount", "created_by", "updated_by", "created_at", "updated_at")
SELECT l."adjustment_id",
       1000000 + ROW_NUMBER() OVER (PARTITION BY l."adjustment_id" ORDER BY l."sequence_no", i."sequence_no"),
       l."description", i."sub_ledger_balance_id", l."effect",
       i."amount", i."base_amount", i."created_by", i."updated_by", i."created_at", i."updated_at"
  FROM "fin_item_adjustment_line_item" i
  JOIN "fin_item_adjustment_line" l ON l."id" = i."line_id";

DELETE FROM "fin_item_adjustment_line" l
 WHERE EXISTS (SELECT 1 FROM "fin_item_adjustment_line_item" i WHERE i."line_id" = l."id");

-- Renumbered through negatives, so no two rows share a number on the way.
UPDATE "fin_item_adjustment_line" l
   SET "sequence_no" = -n.seq
  FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "adjustment_id" ORDER BY "sequence_no") AS seq
          FROM "fin_item_adjustment_line") n
 WHERE n."id" = l."id";
UPDATE "fin_item_adjustment_line" SET "sequence_no" = -"sequence_no";

ALTER TABLE "fin_item_adjustment_line" ALTER COLUMN "effect" SET NOT NULL;
CREATE INDEX "fin_item_adjustment_line_sub_ledger_balance_id_idx"
  ON "fin_item_adjustment_line"("sub_ledger_balance_id");

DROP TABLE "fin_item_adjustment_line_item";

-- The header's figures become the net change: raised less lowered.
UPDATE "fin_item_adjustment"
   SET "adjustment_amount" = -"adjustment_amount",
       "adjustment_base_amount" = -"adjustment_base_amount"
 WHERE "effect" = 'Decrease';

ALTER TABLE "fin_item_adjustment" DROP COLUMN "effect";
