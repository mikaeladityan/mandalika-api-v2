import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { Prisma } from "../../generated/prisma/client.js";
import prisma from "../../config/prisma.js";
import { ForecastService } from "../../module/application/forecast/forecast.service.js";

// Opt-in PostgreSQL check; all fixtures are connection-local temporary tables.
describe.skipIf(!process.env.FORECAST_SORT_TEST_DATABASE_URL)("Forecast get ordering SQL", () => {
    const db = new Client({ connectionString: process.env.FORECAST_SORT_TEST_DATABASE_URL });

    beforeAll(async () => {
        await db.connect();
        await db.query(`
            SET search_path TO pg_temp;
            CREATE TYPE pg_temp."IssuanceType" AS ENUM ('ALL', 'OFFLINE', 'ONLINE');
            CREATE TEMP TABLE products (id int, name text, code text, status text DEFAULT 'ACTIVE',
                deleted_at timestamp, type_id int, size_id int, unit_id int, z_value numeric,
                distribution_percentage numeric, reference_distribution_percentage numeric, safety_percentage numeric);
            CREATE TEMP TABLE product_types (id int, name text, slug text);
            CREATE TEMP TABLE product_size (id int, size numeric);
            CREATE TEMP TABLE unit_of_materials (id int, name text);
            CREATE TEMP TABLE forecasts (product_id int, month int, year int, base_forecast numeric,
                final_forecast numeric, net_forecast numeric, trend text, status text, ratio numeric);
            CREATE TEMP TABLE product_issuances (product_id int, month int, year int, type "IssuanceType", quantity numeric);
            CREATE TEMP TABLE product_inventories (id int, product_id int, warehouse_id int, month int, year int,
                quantity numeric, date timestamp, updated_at timestamp);
            CREATE TEMP TABLE warehouses (id int, name text, type text, deleted_at timestamp);
            CREATE TEMP TABLE safety_stock (product_id int, safety_stock_quantity numeric, safety_stock_ratio numeric,
                avg_forecast numeric, total_forecast numeric, created_at timestamp);
            INSERT INTO product_types VALUES (1,'EXT','ext'), (2,'Parfum','parfum'), (3,'Atomizer','atomizer'),
                (4,'Display','display'), (5,'Tester','display-tester'), (6,'Others','others');
            INSERT INTO product_size VALUES (1,100), (2,50);
            INSERT INTO products (id,name,code,type_id,size_id) VALUES
                (1,'Alpha','visible-a',1,1), (2,'Alpha','a-parfum',2,1), (3,'Alpha','a-small',1,2), (4,'Alpha','a-atom',3,2),
                (5,'Beta','visible-b',1,1), (6,'Beta','b-atom',3,2),
                (7,'Missing','visible-m',1,1), (8,'Zero','visible-z',1,1), (9,'Zero','z-atom',3,2),
                (10,'Absent','visible-n',1,1), (11,'Absent','n-atom',3,2),
                (12,'Zulu','display',4,1), (13,'Alpha','tester',5,1), (14,'Alpha','other',6,1);
            INSERT INTO forecasts (product_id,year,month,final_forecast,net_forecast) VALUES
                (1,2026,4,9000,10000), (5,2026,4,1,2);
            INSERT INTO product_issuances VALUES
                (4,3,2026,'OFFLINE',10), (4,3,2026,'ALL',99999),
                (6,3,2026,'OFFLINE',30), (6,3,2026,'ONLINE',20), (6,3,2026,'ALL',1),
                (4,2,2026,'ALL',9000), (4,1,2026,'ALL',9000),
                (1,3,2026,'OFFLINE',99999), (9,2,2026,'ALL',99999), (9,3,2026,'OFFLINE',0),
                (4,12,2025,'ALL',10), (4,12,2025,'OFFLINE',99999),
                (6,12,2025,'ALL',50), (6,12,2025,'OFFLINE',1);
        `);
    });
    afterAll(async () => { await db.end(); });
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.product.count).mockResolvedValue(14);
        vi.mocked(prisma.forecastPercentage.findMany).mockResolvedValue([]);
        vi.mocked(prisma.$queryRaw).mockImplementation((strings, ...values) => {
            const sql = Array.isArray(strings)
                ? Prisma.sql(strings as unknown as TemplateStringsArray, ...values)
                : strings as Prisma.Sql;
            return db.query(sql.text, sql.values).then((result) => result.rows) as Prisma.PrismaPromise<unknown>;
        });
    });

    const ids = async (query = {}) => (await ForecastService.get({
        start_month: 4, start_year: 2026, horizon: 1, take: 50, ...query,
    })).data.map((row) => row.product_id);

    it("ranks by last-month Atomizer issuance, not forecast, average, or other SKU sales", async () => {
        expect(await ids()).toEqual([5, 6, 1, 2, 3, 4, 10, 11, 7, 8, 9]);
    });
    it("keeps group priority when type, size and search hide Atomizer", async () => {
        expect(await ids({ type_id: 1, size_id: 1, search: 'visible' })).toEqual([5, 1, 10, 7, 8]);
        expect(await ids({ type_id: 1, size_id: 1, search: 'visible', take: 1, page: 2 })).toEqual([1]);
    });
    it("uses December for January M1 and ALL before the threshold", async () => {
        expect(await ids({ start_month: 1 })).toEqual([5, 6, 1, 2, 3, 4, 10, 11, 7, 8, 9]);
    });
    it("uses ALL at the threshold and leaves Others ordering unchanged", async () => {
        expect((await ids({ start_month: 3 })).slice(0, 2)).toEqual([8, 9]);
        expect(await ids({ is_others: true })).toEqual([12, 13, 14]);
    });
});
