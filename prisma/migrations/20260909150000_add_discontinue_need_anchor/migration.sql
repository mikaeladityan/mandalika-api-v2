CREATE TABLE "discontinue_need_anchors" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "month" SMALLINT NOT NULL,
    "year" SMALLINT NOT NULL,
    "anchor_material_id" INTEGER NOT NULL,
    "quantity" DECIMAL(24,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "discontinue_need_anchors_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "discontinue_need_anchors_quantity_check" CHECK ("quantity" >= 0),
    CONSTRAINT "discontinue_need_anchors_month_check" CHECK ("month" BETWEEN 1 AND 12)
);

CREATE UNIQUE INDEX "discontinue_need_anchors_product_id_month_year_key"
    ON "discontinue_need_anchors"("product_id", "month", "year");
