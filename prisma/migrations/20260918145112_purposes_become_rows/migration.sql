-- CreateTable
CREATE TABLE "sys_purpose" (
    "id" SERIAL NOT NULL,
    "purpose_key" TEXT NOT NULL,
    "budget_category_id" INTEGER NOT NULL,
    "partner_category_id" INTEGER,
    "direction" "FlowDirection" NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_purpose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sys_purpose_purpose_key_key" ON "sys_purpose"("purpose_key");

-- CreateIndex
CREATE INDEX "sys_purpose_partner_category_id_idx" ON "sys_purpose"("partner_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_purpose_budget_category_id_partner_category_id_directio_key" ON "sys_purpose"("budget_category_id", "partner_category_id", "direction");

-- AddForeignKey
ALTER TABLE "sys_purpose" ADD CONSTRAINT "sys_purpose_budget_category_id_fkey" FOREIGN KEY ("budget_category_id") REFERENCES "sys_budget_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_purpose" ADD CONSTRAINT "sys_purpose_partner_category_id_fkey" FOREIGN KEY ("partner_category_id") REFERENCES "sys_partner_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
