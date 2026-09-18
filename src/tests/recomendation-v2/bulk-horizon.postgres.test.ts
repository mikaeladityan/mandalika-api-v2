import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { Prisma } from "../../generated/prisma/client.js";
import { RecomendationV2Service } from "../../module/application/recomendation-v2/recomendation-v2.service.js";

const db = vi.hoisted(() => ({
    $executeRaw: vi.fn(),
    rawMaterialInventory: { findFirst: vi.fn() },
    productInventory: { findFirst: vi.fn() },
}));
vi.mock("../../config/prisma.js", () => ({ default: db }));

describe.skipIf(!process.env.BULK_RESET_TEST_DATABASE_URL)("Bulk horizon PostgreSQL persistence", () => {
    const client = new pg.Client({ connectionString: process.env.BULK_RESET_TEST_DATABASE_URL });
    beforeAll(async () => {
        await client.connect();
        await client.query(`BEGIN;
            CREATE TEMP TABLE raw_materials (id int, raw_mat_categories_id int, barcode text, name text, type text, unit_id int, deleted_at timestamp);
            SET LOCAL search_path TO pg_temp, public;
            CREATE TYPE pg_temp."WorkOrderProductStatus" AS ENUM ('ACTIVE','PENDING');
            CREATE TYPE pg_temp."RecommendationStatus" AS ENUM ('DRAFT','ACC','POSTED','REJECTED');
            CREATE TEMP TABLE raw_mat_categories (id int, slug text);
            CREATE TEMP TABLE suppliers (id int, source text);
            CREATE TEMP TABLE supplier_materials (id int, raw_material_id int, supplier_id int, is_preferred boolean, updated_at timestamp);
            CREATE TEMP TABLE unit_raw_materials (id int, name text);
            CREATE TEMP TABLE products (id int, code text, size_id int, type_id int, status text, safety_percentage numeric, deleted_at timestamp, updated_at timestamp);
            CREATE TEMP TABLE product_size (id int, size numeric);
            CREATE TEMP TABLE product_types (id int, slug text);
            CREATE TEMP TABLE recipes (product_id int, raw_mat_id int, quantity numeric, is_active boolean, use_size_calc boolean);
            CREATE TEMP TABLE forecasts (product_id int, month int, year int, final_forecast numeric, net_forecast numeric);
            CREATE TEMP TABLE raw_material_inventories (id int, raw_material_id int, warehouse_id int, month int, year int, quantity numeric, date timestamp, updated_at timestamp);
            CREATE TEMP TABLE product_inventories (id int, product_id int, warehouse_id int, month int, year int, quantity numeric, date timestamp, updated_at timestamp);
            CREATE TEMP TABLE production_orders (id int, status text);
            CREATE TEMP TABLE production_order_items (production_order_id int, raw_material_id int, quantity_planned numeric);
            CREATE TEMP TABLE material_purchase_drafts (
                id serial, raw_mat_id int, month int, year int, product_status "WorkOrderProductStatus", status "RecommendationStatus",
                quantity numeric, horizon int, total_needed numeric, current_stock numeric, stock_fg_x_resep numeric,
                safety_stock_x_resep numeric, created_at timestamp, updated_at timestamp, open_po_id int,
                UNIQUE(raw_mat_id, month, year, product_status));
            INSERT INTO raw_mat_categories VALUES (1,'fragrance-oil'),(2,'packaging');
            INSERT INTO raw_materials VALUES (1,1,'FO-X','Oil','FO',1,NULL),(2,2,'BOX-X','Box','PACKAGING',2,NULL);
            INSERT INTO unit_raw_materials VALUES (1,'ml'),(2,'pcs');
            INSERT INTO products VALUES (1,'FG-X',1,1,'ACTIVE',0,NULL,now());
            INSERT INTO product_size VALUES (1,1);
            INSERT INTO product_types VALUES (1,'parfum');
            INSERT INTO recipes VALUES (1,1,1,true,true),(1,2,1,true,false);
            INSERT INTO forecasts VALUES (1,9,2026,100,100),(1,10,2026,200,200),(1,11,2026,400,400);
            INSERT INTO suppliers VALUES (1,'LOCAL'),(2,'IMPORT');
            INSERT INTO supplier_materials VALUES (1,2,1,true,'2026-01-01'),(2,2,2,true,'2026-09-01');
        `);
        db.rawMaterialInventory.findFirst.mockResolvedValue(null);
        db.productInventory.findFirst.mockResolvedValue(null);
        db.$executeRaw.mockImplementation(async (strings, ...values) => {
            const sql = Prisma.sql(strings, ...values);
            return (await client.query(sql.text, sql.values)).rowCount;
        });
    });
    afterAll(async () => { await client.query('ROLLBACK'); await client.end(); });
    beforeEach(async () => {
        await client.query("TRUNCATE material_purchase_drafts; UPDATE suppliers SET source = CASE WHEN id = 1 THEN 'LOCAL' ELSE 'IMPORT' END");
    });

    it.each(['ffo','lokal'] as const)("persists %s horizon and Total Need after reset left no draft", async type => {
        expect(await RecomendationV2Service.bulkSaveHorizon({ month: 9, year: 2026, horizon: 2, type })).toBe(1);
        expect((await client.query('SELECT month, year, horizon, total_needed::int, quantity::int, status FROM material_purchase_drafts')).rows).toEqual([
            { month: 9, year: 2026, horizon: 2, total_needed: 300, quantity: 0, status: 'DRAFT' },
        ]);
    });

    it("persists the Import material selected by the list even when the newer preferred supplier is Local", async () => {
        await client.query("UPDATE suppliers SET source = CASE WHEN id = 1 THEN 'IMPORT' ELSE 'LOCAL' END");
        expect(await RecomendationV2Service.bulkSaveHorizon({ month: 9, year: 2026, horizon: 2, type: 'impor' })).toBe(1);
        expect((await client.query('SELECT raw_mat_id, horizon, total_needed::int FROM material_purchase_drafts')).rows).toEqual([
            { raw_mat_id: 2, horizon: 2, total_needed: 300 },
        ]);
    });

    it("updates saved horizon in the selected month without clearing quantity or overwriting approved orders", async () => {
        await RecomendationV2Service.bulkSaveHorizon({ month: 9, year: 2026, horizon: 1, type: 'ffo' });
        await client.query('UPDATE material_purchase_drafts SET quantity = 50');
        await RecomendationV2Service.bulkSaveHorizon({ month: 10, year: 2026, horizon: 1, type: 'ffo' });
        expect(await RecomendationV2Service.bulkSaveHorizon({ month: 9, year: 2026, horizon: 2, type: 'ffo' })).toBe(1);
        expect((await client.query('SELECT month, horizon, total_needed::int, quantity::int FROM material_purchase_drafts ORDER BY month')).rows).toEqual([
            { month: 9, horizon: 2, total_needed: 300, quantity: 50 },
            { month: 10, horizon: 1, total_needed: 200, quantity: 0 },
        ]);
        await client.query("UPDATE material_purchase_drafts SET status = 'ACC' WHERE month = 9");
        expect(await RecomendationV2Service.bulkSaveHorizon({ month: 9, year: 2026, horizon: 3, type: 'ffo' })).toBe(0);
        expect((await client.query('SELECT horizon FROM material_purchase_drafts WHERE month = 9')).rows).toEqual([{ horizon: 2 }]);
    });
});
