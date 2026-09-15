-- CreateTable
CREATE TABLE "outlet_issuances" (
    "id" SERIAL NOT NULL,
    "outlet_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "quantity" DECIMAL(18,2) NOT NULL,
    "import_batch_id" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outlet_issuances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outlet_issuances_outlet_id_product_id_date_key" ON "outlet_issuances"("outlet_id", "product_id", "date");
CREATE INDEX "outlet_issuances_month_year_idx" ON "outlet_issuances"("month", "year");
CREATE INDEX "outlet_issuances_outlet_id_date_idx" ON "outlet_issuances"("outlet_id", "date");
CREATE INDEX "outlet_issuances_product_id_date_idx" ON "outlet_issuances"("product_id", "date");

-- AddForeignKey
ALTER TABLE "outlet_issuances" ADD CONSTRAINT "outlet_issuances_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outlet_issuances" ADD CONSTRAINT "outlet_issuances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
