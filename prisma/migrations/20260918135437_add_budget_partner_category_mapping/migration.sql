-- AlterTable
ALTER TABLE "sys_budget_category" ADD COLUMN     "allows_in" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allows_out" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "require_partner" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "status" "ActiveStatus" NOT NULL DEFAULT 'Active';

-- AlterTable
ALTER TABLE "sys_partner_category" ADD COLUMN     "status" "ActiveStatus" NOT NULL DEFAULT 'Active';

-- CreateTable
CREATE TABLE "sys_budget_partner_category_mapping" (
    "id" SERIAL NOT NULL,
    "budget_category_id" INTEGER NOT NULL,
    "partner_category_id" INTEGER NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_budget_partner_category_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sys_budget_partner_category_mapping_partner_category_id_idx" ON "sys_budget_partner_category_mapping"("partner_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_budget_partner_category_mapping_budget_category_id_part_key" ON "sys_budget_partner_category_mapping"("budget_category_id", "partner_category_id");

-- AddForeignKey
ALTER TABLE "sys_budget_partner_category_mapping" ADD CONSTRAINT "sys_budget_partner_category_mapping_budget_category_id_fkey" FOREIGN KEY ("budget_category_id") REFERENCES "sys_budget_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_budget_partner_category_mapping" ADD CONSTRAINT "sys_budget_partner_category_mapping_partner_category_id_fkey" FOREIGN KEY ("partner_category_id") REFERENCES "sys_partner_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
