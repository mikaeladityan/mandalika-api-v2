import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { Prisma } from "../../generated/prisma/client.js";
import { rawMaterialStockCtes } from "../../module/application/rawmat/stock/rawmat-stock-sql.js";
import { recommendationForecastSql, recommendationStockSql } from "../../module/application/recomendation-v2/recommendation-stock.js";

// Opt-in SQL integration tests; all fixtures live in temporary tables inside a rollback.
const connectionString = process.env.RM_STOCK_TEST_DATABASE_URL;

describe.skipIf(!connectionString)("RM stock fallback (PostgreSQL)", () => {
    const client = new pg.Client({ connectionString });

    beforeAll(async () => {
        await client.connect();
        await client.query(`BEGIN;
            CREATE TEMP TABLE raw_materials(id int, barcode text, deleted_at timestamp);
            CREATE TEMP TABLE products(id int, code text, deleted_at timestamp);
            CREATE TEMP TABLE warehouses(id int, name text);
            CREATE TEMP TABLE raw_material_inventories(raw_material_id int, warehouse_id int, quantity numeric, year int, month int, date int DEFAULT 1, id int GENERATED ALWAYS AS IDENTITY);
            CREATE TEMP TABLE product_inventories(product_id int, warehouse_id int, quantity numeric, year int, month int, date int DEFAULT 1, id int GENERATED ALWAYS AS IDENTITY);
            CREATE TEMP TABLE production_orders(id int, status text);
            CREATE TEMP TABLE production_order_items(production_order_id int, raw_material_id int, warehouse_id int, quantity_planned numeric);
        `);
    });

    afterAll(async () => {
        await client.query("ROLLBACK");
        await client.end();
    });

    beforeEach(async () => {
        await client.query(`SAVEPOINT fixture;
            INSERT INTO pg_temp.raw_materials VALUES (1, 'SAME', NULL);
            INSERT INTO pg_temp.products VALUES (11, 'SAME', NULL);
            INSERT INTO pg_temp.warehouses VALUES (1, 'RM Production'), (2, 'FG Surabaya'), (3, 'FG Jakarta'), (4, 'RM Other');
            INSERT INTO pg_temp.product_inventories VALUES
                (11, 2, 40, 2026, 9, 2), (11, 2, 30, 2026, 9, 1),
                (11, 2, 999, 2026, 8, 1), (11, 2, 999, 2026, 10, 1), (11, 3, 30, 2026, 9, 1);
            INSERT INTO pg_temp.production_orders VALUES (1, 'PLANNING'), (2, 'RELEASED'), (3, 'CANCELLED');
            INSERT INTO pg_temp.production_order_items VALUES
                (1, 1, NULL, 10), (2, 1, 2, 20), (3, 1, 2, 999);
        `);
    });

    afterEach(async () => {
        await client.query("ROLLBACK TO SAVEPOINT fixture");
    });

    async function stock(warehouseId?: number) {
        const query = Prisma.sql`${rawMaterialStockCtes(9, 2026, 1, warehouseId)}
            SELECT ss.stock_source, COALESCE(st.amount, 0) AS amount,
                COALESCE(st.booked, 0) AS booked, COALESCE(st.avail, 0) AS avail,
                COALESCE(sw.warehouses, '[]'::jsonb) AS source_warehouses,
                COALESCE(sd.details, '{}'::jsonb) AS details
            FROM stock_sources ss
            LEFT JOIN stock_totals st USING (raw_material_id)
            LEFT JOIN stock_details sd USING (raw_material_id)
            LEFT JOIN source_warehouses sw USING (raw_material_id)
            WHERE ss.raw_material_id = 1`;
        const result = await client.query<{
            stock_source: string; amount: string; booked: string; avail: string;
            source_warehouses: Array<{ warehouse_id: number; warehouse_name: string; quantity: number }>;
            details: Record<string, { on_hand: number; booked: number; avail: number }>;
        }>(query.text, query.values);
        const row = result.rows[0]!;
        return { ...row, amount: Number(row.amount), booked: Number(row.booked), avail: Number(row.avail) };
    }

    it.each([null, 0])("uses all FG warehouses when RM is %s", async (quantity) => {
        await client.query("INSERT INTO pg_temp.raw_material_inventories VALUES (1, 1, $1, 2026, 9)", [quantity]);
        const row = await stock();
        expect(row).toMatchObject({ stock_source: "FG", amount: 70, booked: 30, avail: 40 });
        expect(row.source_warehouses).toEqual([
            { warehouse_id: 3, warehouse_name: "FG Jakarta", quantity: 30 },
            { warehouse_id: 2, warehouse_name: "FG Surabaya", quantity: 40 },
        ]);
        expect(row.details["RM Production"]).toEqual({ on_hand: 0, booked: 10, avail: -10 });
        expect(row.details["FG Surabaya"]).toEqual({ on_hand: 40, booked: 20, avail: 20 });
        expect(Object.values(row.details).reduce((sum, value) => sum + value.avail, 0)).toBe(row.avail);
    });

    it("uses FG when no RM snapshot exists, including on a selected RM warehouse page", async () => {
        expect(await stock(1)).toMatchObject({ stock_source: "FG", amount: 70, booked: 30, avail: 40 });
    });

    it("keeps RM even when booking exhausts the RM balance", async () => {
        await client.query("INSERT INTO pg_temp.raw_material_inventories VALUES (1, 1, 15, 2026, 9)");
        const row = await stock();
        expect(row).toMatchObject({ stock_source: "RM", amount: 15, booked: 30, avail: -15 });
        expect(row.source_warehouses).toEqual([{ warehouse_id: 1, warehouse_name: "RM Production", quantity: 15 }]);
    });

    it("checks all RM warehouses before fallback, then applies the RM warehouse filter", async () => {
        await client.query("INSERT INTO pg_temp.raw_material_inventories VALUES (1, 4, 15, 2026, 9)");
        expect(await stock(1)).toMatchObject({ stock_source: "RM", amount: 0, booked: 10, avail: -10 });
        expect(await stock(4)).toMatchObject({ stock_source: "RM", amount: 15, booked: 0, avail: 15 });
    });

    it("uses the latest RM period per warehouse and excludes future snapshots", async () => {
        await client.query(`INSERT INTO pg_temp.raw_material_inventories VALUES
            (1, 1, 999, 2026, 8), (1, 1, 0, 2026, 9), (1, 1, 999, 2026, 10)`);
        expect(await stock()).toMatchObject({ stock_source: "FG", amount: 70 });
    });

    it.each(["OTHER", "", null])("does not match a different or empty barcode: %s", async (barcode) => {
        await client.query("UPDATE pg_temp.raw_materials SET barcode = $1", [barcode]);
        expect(await stock()).toMatchObject({ stock_source: "RM", amount: 0, source_warehouses: [] });
    });

    it("matches business-identical codes despite case and surrounding whitespace", async () => {
        await client.query("UPDATE pg_temp.raw_materials SET barcode = '  same  '");
        const row = await stock();
        expect(row).toMatchObject({ stock_source: "FG", amount: 70 });
    });

    it("ignores deleted FG and keeps zero when FG has no stock", async () => {
        await client.query("UPDATE pg_temp.products SET deleted_at = NOW()");
        expect(await stock()).toMatchObject({ stock_source: "RM", amount: 0 });
        await client.query("UPDATE pg_temp.products SET deleted_at = NULL; DELETE FROM pg_temp.product_inventories");
        expect(await stock()).toMatchObject({ stock_source: "FG", amount: 0, source_warehouses: [] });
    });

    it.each([
        { rmStock: 0, productCode: "SAME", gross: 150, operational: 50, expectedNeed: 150, expectedStock: 70, expectedBuy: 80 },
        { rmStock: 20, productCode: "SAME", gross: 150, operational: 50, expectedNeed: 50, expectedStock: 20, expectedBuy: 30 },
        { rmStock: 0, productCode: "OTHER", gross: 150, operational: 50, expectedNeed: 50, expectedStock: 70, expectedBuy: 0 },
    ])("deducts FG only once (RM=$rmStock, recipe FG=$productCode)", async (scenario) => {
        await client.query("DELETE FROM pg_temp.production_order_items");
        await client.query("INSERT INTO pg_temp.raw_material_inventories VALUES (1, 1, $1, 2026, 9)", [scenario.rmStock]);
        const query = Prisma.sql`
            SELECT ${recommendationForecastSql(Prisma.sql`rm.id`, Prisma.sql`rm.barcode`, 2026, 9)} AS need,
                ${recommendationStockSql(Prisma.sql`rm.id`, Prisma.sql`rm.barcode`, 2026, 9, 2026, 9)} AS stock
            FROM raw_materials rm
            CROSS JOIN (SELECT ${scenario.productCode}::text AS code) p
            CROSS JOIN (SELECT ${scenario.gross}::numeric AS net_forecast, ${scenario.operational}::numeric AS final_forecast) f
            WHERE rm.id = 1`;
        const result = await client.query<{ need: string; stock: string }>(query.text, query.values);
        const row = result.rows[0]!;
        expect(Number(row.need)).toBe(scenario.expectedNeed);
        expect(Number(row.stock)).toBe(scenario.expectedStock);
        expect(Math.max(0, Number(row.need) - Number(row.stock))).toBe(scenario.expectedBuy);
    });
});
