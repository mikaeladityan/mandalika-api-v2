CREATE TYPE "WorkOrderProductStatus" AS ENUM ('ACTIVE', 'PENDING');

ALTER TABLE "material_purchase_drafts"
ADD COLUMN "product_status" "WorkOrderProductStatus" NOT NULL DEFAULT 'ACTIVE';

DROP INDEX IF EXISTS "material_purchase_drafts_raw_mat_id_month_year_key";

CREATE UNIQUE INDEX "material_purchase_drafts_raw_mat_id_month_year_product_status_key"
ON "material_purchase_drafts"("raw_mat_id", "month", "year", "product_status");
