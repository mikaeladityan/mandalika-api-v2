ALTER TABLE "forecasts"
ADD COLUMN "net_forecast" DECIMAL(18, 2);

UPDATE "forecasts"
SET "net_forecast" = "final_forecast"
WHERE "net_forecast" IS NULL;
