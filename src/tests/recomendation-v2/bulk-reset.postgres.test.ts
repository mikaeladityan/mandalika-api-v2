import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { RecomendationV2Service } from "../../module/application/recomendation-v2/recomendation-v2.service.js";

const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn() }));
vi.mock("../../config/prisma.js", () => ({ default: db }));

// Explicit opt-in. All fixtures are connection-local TEMP tables, never application tables.
describe.skipIf(!process.env.BULK_RESET_TEST_DATABASE_URL)("Bulk reset PostgreSQL isolation", () => {
    const client = new pg.Client({ connectionString: process.env.BULK_RESET_TEST_DATABASE_URL });
    beforeAll(async () => {
        await client.connect();
        await client.query(`
            CREATE TEMP TABLE raw_materials (id int, raw_mat_categories_id int, barcode text, deleted_at timestamp);
            CREATE TEMP TABLE raw_mat_categories (id int, slug text);
            CREATE TEMP TABLE suppliers (id int, source text);
            CREATE TEMP TABLE supplier_materials (id int, raw_material_id int, supplier_id int, is_preferred boolean, updated_at timestamp);
            CREATE TEMP TABLE material_purchase_drafts (id int, raw_mat_id int, month int, year int, product_status text, status text, quantity int, horizon int, total_needed int);
            INSERT INTO raw_mat_categories VALUES (1, 'fragrance-oil'), (2, 'packaging');
            INSERT INTO raw_materials VALUES (1,1,'FO-X',NULL), (2,2,'BOX-X',NULL), (3,1,'FO-Y',NULL), (4,1,'FO-Z',NULL);
            INSERT INTO suppliers VALUES (1,'LOCAL'), (2,'IMPORT');
            INSERT INTO supplier_materials VALUES (1,2,1,true,'2026-01-01'), (2,2,2,true,'2026-09-01');
        `);
        db.$queryRaw.mockImplementation(async sql => (await client.query(sql.text, sql.values)).rows);
        db.$executeRaw.mockImplementation(async sql => (await client.query(sql.text, sql.values)).rowCount);
    });
    afterAll(async () => { await client.end(); });
    beforeEach(async () => {
        await client.query(`TRUNCATE material_purchase_drafts;
            INSERT INTO material_purchase_drafts VALUES
            (1,1,9,2026,'ACTIVE','DRAFT',0,4,120),
            (2,3,9,2026,'ACTIVE','ACC',50,4,120),
            (3,1,8,2026,'ACTIVE','DRAFT',0,4,120),
            (4,1,9,2025,'ACTIVE','DRAFT',0,4,120),
            (5,1,9,2026,'PENDING','DRAFT',0,4,120),
            (6,4,9,2026,'ACTIVE','POSTED',50,4,120),
            (7,2,9,2026,'ACTIVE','DRAFT',0,4,120);`);
    });
    it("removes both saved horizon and ordered quantity only in the selected period/category", async () => {
        const scope = { month: 9, year: 2026, type: "ffo" as const };
        expect(await RecomendationV2Service.previewBulkReset(scope)).toEqual({ count: 2 });
        expect(await RecomendationV2Service.bulkResetWorkOrders(scope)).toEqual({ count: 2 });
        expect((await client.query('SELECT id FROM material_purchase_drafts ORDER BY id')).rows.map(r => r.id)).toEqual([3,4,5,6,7]);
    });
    it("resets the same preferred supplier category shown in the recommendation list", async () => {
        const scope = { month: 9, year: 2026, type: "lokal" as const };
        expect(await RecomendationV2Service.previewBulkReset(scope)).toEqual({ count: 1 });
        expect(await RecomendationV2Service.bulkResetWorkOrders(scope)).toEqual({ count: 1 });
        expect((await client.query('SELECT id FROM material_purchase_drafts WHERE id = 7')).rows).toEqual([]);
    });
});
