ALTER TABLE "purchase_receipt_items"
ADD COLUMN "qty_missing" DECIMAL(18, 2) NOT NULL DEFAULT 0;
