-- CreateTable
CREATE TABLE "cash_bank_period" (
    "cash_bank_id" INTEGER NOT NULL,
    "period" DATE NOT NULL,
    "opening" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_in" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_out" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "closing" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "min_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "base_opening" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "base_total_in" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "base_total_out" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "base_closing" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_bank_period_pkey" PRIMARY KEY ("cash_bank_id","period")
);

-- AddForeignKey
ALTER TABLE "cash_bank_period" ADD CONSTRAINT "cash_bank_period_cash_bank_id_fkey" FOREIGN KEY ("cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill from the book as it stands, so the chain is true on any database.
-- Each resource gets every month from its first entry's to its latest's.
WITH e AS (
    SELECT cash_bank_id,
           date_trunc('month', entry_date)::date AS period,
           movement,
           base_movement,
           SUM(movement) OVER (PARTITION BY cash_bank_id ORDER BY entry_date, id) AS run
    FROM cash_bank_ledger
),
m AS (
    SELECT cash_bank_id, period,
           COALESCE(SUM(movement) FILTER (WHERE movement > 0), 0)       AS total_in,
           COALESCE(-SUM(movement) FILTER (WHERE movement <= 0), 0)     AS total_out,
           COALESCE(SUM(base_movement) FILTER (WHERE movement > 0), 0)  AS base_in,
           COALESCE(-SUM(base_movement) FILTER (WHERE movement <= 0), 0) AS base_out,
           MIN(run) AS min_run
    FROM e GROUP BY cash_bank_id, period
),
months AS (
    SELECT b.cash_bank_id, gs::date AS period
    FROM (SELECT cash_bank_id, MIN(period) AS lo, MAX(period) AS hi FROM m GROUP BY cash_bank_id) b,
         generate_series(b.lo, b.hi, interval '1 month') gs
),
f AS (
    SELECT mo.cash_bank_id, mo.period,
           COALESCE(m.total_in, 0) AS total_in, COALESCE(m.total_out, 0) AS total_out,
           COALESCE(m.base_in, 0) AS base_in, COALESCE(m.base_out, 0) AS base_out,
           m.min_run,
           COALESCE(SUM(COALESCE(m.total_in, 0) - COALESCE(m.total_out, 0)) OVER w, 0) AS opening,
           COALESCE(SUM(COALESCE(m.base_in, 0) - COALESCE(m.base_out, 0)) OVER w, 0) AS base_opening
    FROM months mo LEFT JOIN m USING (cash_bank_id, period)
    WINDOW w AS (PARTITION BY mo.cash_bank_id ORDER BY mo.period ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
)
INSERT INTO cash_bank_period (cash_bank_id, period, opening, total_in, total_out, closing, min_balance,
                              base_opening, base_total_in, base_total_out, base_closing)
SELECT cash_bank_id, period, opening, total_in, total_out, opening + total_in - total_out,
       LEAST(opening, COALESCE(min_run, opening)),
       base_opening, base_in, base_out, base_opening + base_in - base_out
FROM f;
