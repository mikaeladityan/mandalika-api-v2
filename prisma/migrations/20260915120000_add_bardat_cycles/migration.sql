CREATE TABLE "outlet_bardat_cycles" (
    "id" SERIAL PRIMARY KEY,
    "outlet_id" INTEGER NOT NULL UNIQUE REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "pattern" VARCHAR(10) NOT NULL,
    "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "interval_days" INTEGER,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bardat_cycle_dates" CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
    CONSTRAINT "bardat_cycle_pattern" CHECK (
      ("pattern" = 'WEEKLY' AND cardinality("weekdays") > 0 AND "weekdays" <@ ARRAY[0,1,2,3,4,5,6] AND "interval_days" IS NULL)
      OR ("pattern" = 'INTERVAL' AND "interval_days" IS NOT NULL AND "interval_days" BETWEEN 1 AND 365 AND cardinality("weekdays") = 0)
    )
);
