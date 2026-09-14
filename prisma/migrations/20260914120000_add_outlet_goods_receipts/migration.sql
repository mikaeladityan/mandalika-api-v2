CREATE TABLE "outlet_goods_receipts" (
    "id" SERIAL NOT NULL,
    "outlet_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "import_batch_id" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outlet_goods_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outlet_goods_receipts_outlet_id_product_id_date_key"
ON "outlet_goods_receipts"("outlet_id", "product_id", "date");
CREATE INDEX "outlet_goods_receipts_month_year_idx"
ON "outlet_goods_receipts"("month", "year");
CREATE INDEX "outlet_goods_receipts_outlet_id_date_idx"
ON "outlet_goods_receipts"("outlet_id", "date");
CREATE INDEX "outlet_goods_receipts_product_id_date_idx"
ON "outlet_goods_receipts"("product_id", "date");

ALTER TABLE "outlet_goods_receipts"
ADD CONSTRAINT "outlet_goods_receipts_outlet_id_fkey"
FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "outlet_goods_receipts"
ADD CONSTRAINT "outlet_goods_receipts_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
