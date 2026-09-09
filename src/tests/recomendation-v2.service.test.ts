import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RecomendationV2Service } from "../module/application/recomendation-v2/recomendation-v2.service.js";
import prisma from "../config/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { SUPPLIER_OBSCURE_REGEX } from "../lib/utils/supplier-obscure.js";

describe("RecomendationV2Service - Override Features", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("groups shared materials under each FG before pagination without calculating needs", async () => {
        const raw = vi.mocked(prisma.$queryRaw);
        raw.mockResolvedValueOnce([]).mockResolvedValueOnce([1, 2].map((fgId) => ({
            fg_id: fgId, fg_code: `FG-${fgId}`, fg_name: fgId === 1 ? "VAMO" : `Discontinue ${fgId}`,
            material_id: 7, material_name: "Fragrance Oil VAMO", barcode: "RM-7",
            needs_data: [{ month: 9, year: 2026, needs: 100 }, { month: 10, year: 2026, needs: 200 }],
            sales_data: [], po_data: [], work_order_data: null,
            total_forecast_horizon_dynamic: 300, recommendation_quantity: 240,
            current_stock: 50, open_po: 20, safety_stock_x_resep: 10,
            stock_fg_x_resep: 0, forecast_needed: 300, ranking: 1, moq: 1,
        }))).mockResolvedValueOnce([{ count: 2 }]).mockResolvedValueOnce([
            { product_id: 1, estimated_producible_fg: 42 },
            { product_id: 2, estimated_producible_fg: 17 },
        ]);
        const result = await RecomendationV2Service.list({
            page: 1, take: 25, month: 9, year: 2026, product_status: "PENDING",
            sales_months: 3, forecast_months: 2, po_months: 3,
        });
        expect(result.len).toBe(2);
        expect(result.data.map((row) => row.row_id)).toEqual(["1_7", "2_7"]);
        expect(result.data[0]?.finished_goods).toEqual([{ id: 1, code: "FG-1", name: "VAMO" }]);
        expect(result.data[0]?.is_fg_named_material).toBe(true);
        expect(result.data[1]?.is_fg_named_material).toBe(false);
        expect(result.data[0]?.estimated_producible_fg).toBe(42);
        expect(result.data[1]?.estimated_producible_fg).toBe(17);
        expect(result.data[0]?.total_needed_horizon).toBe(0);
        expect(result.data[0]?.forecast_needed).toBe(0);
        expect(result.data[0]?.total_needed_fix_2_months).toBe(0);
        expect(result.data[0]?.needs.every((need) => need.quantity === 0 && need.override_needs == null)).toBe(true);
        expect(result.data[0]?.recommendation_quantity).toBe(0);
        expect(result.data[0]?.safety_stock_x_resep).toBe(0);
        expect(result.data[0]?.product_status).toBe("PENDING");
        expect(result.data[0]?.work_order_horizon).toBeNull();
        // Flatten the tagged template to verify every product calculation is scoped to Discontinue.
        const call = raw.mock.calls[1];
        if (!call) throw new Error("Missing recommendation query");
        const template = call[0];
        const sql = Array.isArray(template)
            ? Prisma.sql(template as TemplateStringsArray, ...call.slice(1)).sql
            : "";
        expect(sql).toContain("fg_group.fg_name ASC, fg_group.fg_id ASC");
        expect(sql).toContain("regexp_replace(lower(base.material_name)");
        expect(sql.indexOf("fg_group.fg_name ASC")).toBeLessThan(sql.lastIndexOf("LIMIT"));
        const countCall = raw.mock.calls[2];
        if (!countCall || !Array.isArray(countCall[0])) throw new Error("Missing count query");
        const countSql = Prisma.sql(countCall[0] as TemplateStringsArray, ...countCall.slice(1)).sql;
        expect(countSql).toContain("gr.raw_mat_id = rm.id");
        expect(countSql).toContain("fg_group ON TRUE");
        expect(sql).toContain("p.status = 'PENDING'");
        expect(sql).not.toContain("p.status = 'ACTIVE'");
        expect(sql).toContain("dp.status = 'PENDING'");
        expect(sql).toContain("rm.barcode IS DISTINCT FROM 'FO-ALK'");
        expect(sql).toContain("0::numeric AS safety_stock_x_resep");
        expect(sql).toContain("0::numeric AS total_forecast_horizon_dynamic");
        expect(sql).toContain("ON o.raw_material_id = fm.id");
        expect(result.data[0]?.work_order_id).toBeNull();
        expect(result.data[0]?.work_order_horizon).toBeNull();
        expect(sql).toContain("AND ?");
        const capacityCall = raw.mock.calls[3];
        if (!capacityCall) throw new Error("Missing production capacity query");
        const capacityArg = capacityCall[0] as { sql?: string };
        const capacitySql = capacityArg.sql ?? "";
        expect(capacitySql).toContain("MIN(capacity)");
        expect(capacitySql).toContain("rec.use_size_calc");
        expect(capacitySql).toContain("rm.barcode IS DISTINCT FROM 'FO-ALK'");
        expect(capacitySql).toContain("po.status = 'RELEASED'");
    });

    it.each(["PENDING", "ACTIVE"] as const)("scopes bulk horizon calculations to %s FGs", async (product_status) => {
        await RecomendationV2Service.bulkSaveHorizon({ month: 9, year: 2026, horizon: 3, product_status });
        const call = vi.mocked(prisma.$executeRaw).mock.calls[0];
        if (!call || !Array.isArray(call[0])) throw new Error("Missing bulk SQL");
        const sql = Prisma.sql(call[0] as TemplateStringsArray, ...call.slice(1)).sql;
        expect(sql).toContain(`p.status = '${product_status}'`);
        expect(sql).not.toContain(`p.status = '${product_status === "PENDING" ? "ACTIVE" : "PENDING"}'`);
        if (product_status === "PENDING") {
            expect(sql).toContain("dp.status = 'PENDING'");
            expect(sql).toContain("rm.barcode IS DISTINCT FROM 'FO-ALK'");
            expect(sql).toContain("0::numeric AS safety_stock_x_resep");
            expect(sql).toContain("0::numeric AS total_needed");
        } else {
            expect(sql).toContain("COALESCE(ss.total, 0) AS safety_stock_x_resep");
            expect(sql).not.toContain("rm.barcode IS DISTINCT FROM 'FO-ALK'");
        }
        expect(sql).toContain(`"material_purchase_drafts".status = 'DRAFT'`);
    });

    describe("saveNeedOverride", () => {
        const mockBody = {
            raw_material_id: 1,
            month: 4,
            year: 2026,
            quantity: 1500
        };

        it("should upsert need override successfully", async () => {
            const mockUpsert = vi.fn().mockResolvedValue({
                id: 1,
                ...mockBody,
                updated_at: new Date()
            });
            
            // @ts-ignore
            prisma.rawMaterialNeedOverride = { upsert: mockUpsert };

            const result = await RecomendationV2Service.saveNeedOverride(mockBody);

            expect(result).toBeDefined();
            expect(result.message).toBe("Override berhasil disimpan");
            expect(result.cascaded).toBe(0);
            expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
                where: {
                    raw_material_id_month_year: {
                        raw_material_id: mockBody.raw_material_id,
                        month: mockBody.month,
                        year: mockBody.year
                    }
                },
                create: expect.objectContaining({ quantity: 1500 }),
                update: expect.objectContaining({ quantity: 1500 })
            }));
        });
    });

    describe("list with overrides", () => {
        it("uses operational final_forecast only and keeps FG stock as metadata", async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(Date.UTC(2026, 3, 10)));
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ count: 0n }]);

            await RecomendationV2Service.list({
                page: 1, take: 10, type: "lokal", sales_months: 4, forecast_months: 3, po_months: 3,
            });

            const queryArg = (prisma.$queryRaw as any).mock.calls[1]?.[0] as
                | readonly string[]
                | { strings?: readonly string[] };
            const sql = "strings" in queryArg
                ? queryArg.strings?.join(" ") ?? ""
                : (queryArg as readonly string[]).join(" ");
            expect(sql).toContain("f.final_forecast * rec.quantity");
            expect(sql).not.toContain("f.net_forecast");
            expect(sql).toContain("stock_fg_x_resep");
            expect(sql).not.toMatch(/total_forecast_horizon_dynamic\s*-\s*[^)]*stock_fg_x_resep/);
        });

        it("should include override data in the response", async () => {
            // Use fake timers to control internal 'now'
            vi.useFakeTimers();
            const mockDate = new Date(Date.UTC(2026, 3, 10)); // April 10, 2026
            vi.setSystemTime(mockDate);

            const mockRows = [
                {
                    material_id: 1,
                    material_name: "Material Test",
                    needs_data: JSON.stringify([
                        { month: 4, year: 2026, needs: 1000, override_needs: 1500 }
                    ]),
                    sales_data: JSON.stringify([]),
                    po_data: JSON.stringify([]),
                    work_order_data: null,
                    ranking: 1n, // Mock Prisma BigInt
                    current_stock: 500,
                    open_po: 0,
                    recommendation_val: 1000,
                    barcode: "RM-001",
                    supplier_name: "Supplier A",
                    uom: "KG",
                    moq: 100,
                    lead_time: 7,
                    work_order_horizon: 1,
                    forecast_needed: 1000,
                    total_forecast_horizon_dynamic: 1000,
                    total_forecast_horizon_max: 3000,
                    current_month_sales: 0,
                    safety_stock_x_resep: 0,
                    stock_fg_x_resep: 0
                }
            ];

            // @ts-ignore
            prisma.$queryRaw.mockResolvedValueOnce([]); // historical months with outstanding POs
            // @ts-ignore
            prisma.$queryRaw.mockResolvedValueOnce(mockRows); // main rows query
            // @ts-ignore
            prisma.$queryRaw.mockResolvedValueOnce([{ count: 1n }]); // totalQuery (COUNT)

            const result = await RecomendationV2Service.list({
                page: 1,
                take: 10,
                type: 'lokal',
                sales_months: 3,
                forecast_months: 3,
                po_months: 3
            });

            // internal 'now' is April, so forecast periods start at month 4
            const target = result.data[0]!.needs!.find(n => n.month === 4 && n.year === 2026);
            
            expect(target).toBeDefined();
            expect(target?.override_needs).toBe(1500);
            expect(target?.quantity).toBe(1000);
        });
    });

    describe("historical Open PO columns", () => {
        const query = {
            page: 1, take: 10, month: 9, year: 2026,
            type: "lokal" as const, sales_months: 3, forecast_months: 3, po_months: 2,
        };
        const mockList = (months: { month: number; year: number }[]) => {
            vi.mocked(prisma.$queryRaw)
                .mockResolvedValueOnce(months)
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ count: 0 }]);
        };

        it("does not retain the previous month when no RM has an outstanding PO", async () => {
            mockList([]);
            const result = await RecomendationV2Service.list(query);
            expect(result.periods.po_periods.map(p => p.key)).toEqual([
                "9-2026", "10-2026", "11-2026",
            ]);
        });

        it("keeps occupied historical months without filling empty gaps or truncating old POs", async () => {
            mockList([{ month: 12, year: 2024 }, { month: 2, year: 2026 }, { month: 7, year: 2026 }]);
            const result = await RecomendationV2Service.list(query);
            expect(result.periods.po_periods.map(p => p.key)).toEqual([
                "12-2024", "2-2026", "7-2026", "9-2026", "10-2026", "11-2026",
            ]);
        });

        it("drops a historical month on refresh after its last outstanding PO disappears", async () => {
            mockList([{ month: 7, year: 2026 }]);
            const before = await RecomendationV2Service.list(query);
            expect(before.periods.po_periods[0]?.key).toBe("7-2026");
            mockList([]);
            const after = await RecomendationV2Service.list(query);
            expect(after.periods.po_periods.map(p => p.key)).not.toContain("7-2026");
        });

        it("checks positive outstanding lines across all RM independently of search and pagination", async () => {
            mockList([{ month: 7, year: 2026 }]);
            const result = await RecomendationV2Service.list({ ...query, page: 3, search: "FILTERED-RM" });
            expect(result.data).toEqual([]);
            expect(result.periods.po_periods[0]?.key).toBe("7-2026");
            const call = vi.mocked(prisma.$queryRaw).mock.calls[0]!;
            const sql = (call[0] as TemplateStringsArray).join(" ");
            expect(sql).toContain("SELECT DISTINCT");
            expect(sql).toContain("po.status = 'ORDERED'");
            expect(sql).not.toMatch(/SUBMITTED|APPROVED|DRAFT/);
            expect(sql).toContain("poi.qty_received < poi.qty_ordered");
            expect(sql).toContain("rm.deleted_at IS NULL");
            expect(sql).not.toMatch(/ILIKE|LIMIT|OFFSET/);
            expect(call.slice(1)).toEqual([2026 * 12 + 9]);
        });

        it("uses the same outstanding ORDERED scope for monthly quantities and stock calculations", async () => {
            mockList([]);
            await RecomendationV2Service.list(query);
            const call = vi.mocked(prisma.$queryRaw).mock.calls[1]!;
            const sql = (call[0] as TemplateStringsArray).join(" ");
            expect(sql.match(/po.status = 'ORDERED'/g)).toHaveLength(2);
            expect(sql.match(/poi.qty_received < poi.qty_ordered/g)).toHaveLength(2);
            expect(sql).not.toMatch(/SUBMITTED|APPROVED/);
        });

        it("preserves the planning horizon across a year boundary", async () => {
            mockList([]);
            const result = await RecomendationV2Service.list({ ...query, month: 12 });
            expect(result.periods.po_periods.map(p => p.key)).toEqual([
                "12-2026", "1-2027", "2-2027",
            ]);
        });
    });

    describe("createOpenPoCell - po_number conflict handling", () => {
        const body = { raw_mat_id: 1, month: 6, year: 2026, quantity: 100 };
        const userId = "user-1";

        const buildTx = (
            createImpl: ReturnType<typeof vi.fn>,
            maxSeq: number | string = 5,
        ) => ({
            $executeRaw: vi.fn().mockResolvedValue(1),
            $queryRaw: vi.fn().mockResolvedValue([{ max_seq: maxSeq }]),
            rawMaterial: {
                findUnique: vi.fn().mockResolvedValue({
                    id: 1,
                    name: "RM Test",
                    barcode: "RM-TEST",
                    unit_raw_material: { name: "KG" },
                    raw_mat_category: { name: "Cat" },
                    supplier_materials: [{ min_buy: 10 }],
                }),
            },
            supplierMaterial: {
                findFirst: vi
                    .fn()
                    .mockResolvedValueOnce({ supplier_id: 7, unit_price: 1000 })
                    .mockResolvedValue({ unit_price: 1000 }),
            },
            supplier: {
                findUnique: vi.fn().mockResolvedValue({ id: 7, name: "Supplier" }),
            },
            purchaseOrderItem: { findFirst: vi.fn().mockResolvedValue(null) },
            purchaseOrder: { create: createImpl },
            purchaseTracking: { create: vi.fn().mockResolvedValue({}) },
        });

        const buildPoResult = (po_number: string) => ({
            id: 99,
            po_number,
            status: "ORDERED",
            supplier_id: 7,
            supplier_name: "Supplier",
            po_date: new Date("2026-06-01"),
            items: [{ id: 999, qty_ordered: 100, qty_received: 0, unit_price: 1000, uom: "KG" }],
        });

        it("retries on P2002 regardless of meta.target shape (covers Prisma 6 array form)", async () => {
            const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
                code: "P2002",
                clientVersion: "test",
                meta: { target: ["po_number"] },
            });
            const create = vi.fn().mockRejectedValueOnce(p2002).mockResolvedValue(buildPoResult("PO-x-007"));
            // @ts-ignore
            prisma.$transaction = vi.fn(async (cb) => cb(buildTx(create)));

            const result = await RecomendationV2Service.createOpenPoCell(body, userId);

            expect(create).toHaveBeenCalledTimes(2);
            expect(result.po_number).toBe("PO-x-007");
        });

        it("retries on P2002 with constraint-name target shape (e.g. older Prisma / Postgres index name)", async () => {
            const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
                code: "P2002",
                clientVersion: "test",
                // Some Prisma versions return constraint name as string here
                meta: { target: "purchase_orders_po_number_key" },
            });
            const create = vi.fn().mockRejectedValueOnce(p2002).mockResolvedValue(buildPoResult("PO-x-008"));
            // @ts-ignore
            prisma.$transaction = vi.fn(async (cb) => cb(buildTx(create)));

            const result = await RecomendationV2Service.createOpenPoCell(body, userId);

            expect(create).toHaveBeenCalledTimes(2);
            expect(result.po_number).toBe("PO-x-008");
        });

        it("sequential JAN then MAR for same SKU produces distinct po_numbers (user's repro)", async () => {
            // Simulate JAN already exists (max_seq=1), MAR call should succeed with seq=2.
            const createJan = vi.fn().mockResolvedValue(buildPoResult("PO-20260604-001"));
            const createMar = vi.fn().mockResolvedValue(buildPoResult("PO-20260604-002"));

            // @ts-ignore
            prisma.$transaction = vi
                .fn()
                .mockImplementationOnce(async (cb: any) => cb(buildTx(createJan, 0)))
                .mockImplementationOnce(async (cb: any) => cb(buildTx(createMar, 1)));

            const jan = await RecomendationV2Service.createOpenPoCell(
                { ...body, month: 1, year: 2026 },
                userId,
            );
            const mar = await RecomendationV2Service.createOpenPoCell(
                { ...body, month: 3, year: 2026 },
                userId,
            );

            expect(jan.po_number).toBe("PO-20260604-001");
            expect(mar.po_number).toBe("PO-20260604-002");
            expect(createJan).toHaveBeenCalledTimes(1);
            expect(createMar).toHaveBeenCalledTimes(1);
        });

        it("rethrows non-P2002 errors without retry", async () => {
            const err = new Error("boom");
            const create = vi.fn().mockRejectedValue(err);
            // @ts-ignore
            prisma.$transaction = vi.fn(async (cb) => cb(buildTx(create)));

            await expect(
                RecomendationV2Service.createOpenPoCell(body, userId),
            ).rejects.toThrow("boom");
            expect(create).toHaveBeenCalledTimes(1);
        });

        it("gives up after MAX_RETRIES (20) and throws last P2002", async () => {
            const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
                code: "P2002",
                clientVersion: "test",
                meta: { target: ["po_number"] },
            });
            const create = vi.fn().mockRejectedValue(p2002);
            // @ts-ignore
            prisma.$transaction = vi.fn(async (cb) => cb(buildTx(create)));

            await expect(
                RecomendationV2Service.createOpenPoCell(body, userId),
            ).rejects.toBe(p2002);
            expect(create).toHaveBeenCalledTimes(20);
        });

        it("masks supplier identity in createOpenPoCell return", async () => {
            const create = vi.fn().mockResolvedValue(buildPoResult("PO-x-009"));
            // @ts-ignore
            prisma.$transaction = vi.fn(async (cb) => cb(buildTx(create)));

            const result = await RecomendationV2Service.createOpenPoCell(body, userId);

            expect(result.supplier_id).toBe(7);
            expect(result.supplier_name).toBe("SUP-007");
            expect(result.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(result.supplier_name).toHaveLength(7);
            expect(result.supplier_name).not.toContain("Supplier");
        });

        it("creates ORDERED tracking ETA from the selected supplier lead time", async () => {
            const orderedAt = new Date("2026-06-10T00:00:00.000Z");
            const create = vi.fn().mockResolvedValue({
                ...buildPoResult("PO-x-010"),
                ordered_at: orderedAt,
            });
            const tx = buildTx(create);
            tx.supplierMaterial.findFirst = vi
                .fn()
                .mockResolvedValueOnce({ supplier_id: 7, unit_price: 1000 })
                .mockResolvedValue({ unit_price: 1000, lead_time: 12 });
            // @ts-ignore
            prisma.$transaction = vi.fn(async (cb) => cb(tx));

            await RecomendationV2Service.createOpenPoCell(body, userId);

            expect(tx.purchaseTracking.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    po_id: 99,
                    order_status: "ORDERED",
                    eta_date: new Date("2026-06-22T00:00:00.000Z"),
                }),
            });
        });
    });

    describe("createOpenPosFromDrafts", () => {
        const userId = "user-1";

        const buildDraft = (overrides: Partial<any> = {}) => ({
            id: 1,
            raw_mat_id: 10,
            month: 6,
            year: 2026,
            quantity: 100,
            status: "DRAFT",
            raw_material: {
                id: 10,
                name: "RM A",
                barcode: "RM-A",
                unit_raw_material: { name: "KG" },
                raw_mat_category: { name: "Cat" },
                supplier_materials: [
                    { supplier_id: 7, min_buy: 10, is_preferred: true },
                ],
            },
            ...overrides,
        });

        const buildTx = (
            drafts: any[],
            createImpl: ReturnType<typeof vi.fn>,
            maxSeq: number | string = 0,
            existingPoLines: { raw_material_id: number; month: number; year: number }[] = [],
        ) => ({
            $executeRaw: vi.fn().mockResolvedValue(1),
            // 1st $queryRaw call: existing PO lines lookup; 2nd: po_number max_seq
            $queryRaw: vi
                .fn()
                .mockResolvedValueOnce(existingPoLines)
                .mockResolvedValueOnce([{ max_seq: maxSeq }])
                .mockResolvedValue([{ max_seq: maxSeq }]),
            user: { findUnique: vi.fn().mockResolvedValue({ id: userId }) },
            materialPurchaseDraft: {
                findMany: vi.fn().mockResolvedValue(drafts),
                updateMany: vi.fn().mockResolvedValue({ count: drafts.length }),
            },
            supplierMaterial: {
                findFirst: vi
                    .fn()
                    .mockResolvedValueOnce({ supplier_id: 7, unit_price: 1000 })
                    .mockResolvedValue({ unit_price: 1000 }),
            },
            supplier: { findUnique: vi.fn().mockResolvedValue({ id: 7, name: "Supplier A" }) },
            purchaseOrderItem: { findFirst: vi.fn().mockResolvedValue(null) },
            purchaseOrder: { create: createImpl },
            purchaseTracking: { create: vi.fn().mockResolvedValue({}) },
        });

        it("creates 1 PO with 1 item for a single draft and marks it ACC", async () => {
            const draft = buildDraft();
            const create = vi.fn().mockResolvedValue({ id: 501 });
            const tx = buildTx([draft], create);
            // @ts-ignore
            prisma.$transaction = vi.fn(async (cb) => cb(tx));

            const result = await RecomendationV2Service.createOpenPosFromDrafts([1], userId);

            expect(create).toHaveBeenCalledTimes(1);
            const arg = create.mock.calls[0]![0];
            expect(arg.data.status).toBe("ORDERED");
            expect(arg.data.supplier_id).toBe(7);
            expect(arg.data.items.create).toHaveLength(1);
            expect(arg.data.items.create[0].qty_ordered).toBe(100);
            expect(result.created_po_ids).toEqual([501]);
            expect(result.affected_draft_ids).toEqual([1]);
            expect(tx.materialPurchaseDraft.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: { in: [1] }, status: "DRAFT" },
                    data: expect.objectContaining({ status: "ACC", pic_id: userId }),
                }),
            );
        });

        it("groups drafts with same supplier+month into one PO, different (supplier|month) into separate POs", async () => {
            // Draft 1: supplier 7, jun 2026
            // Draft 2: supplier 7, jun 2026 (same group as 1)
            // Draft 3: supplier 7, jul 2026 (different month → new group)
            const drafts = [
                buildDraft({ id: 1, raw_mat_id: 10, month: 6, year: 2026, quantity: 100 }),
                buildDraft({
                    id: 2,
                    raw_mat_id: 11,
                    month: 6,
                    year: 2026,
                    quantity: 50,
                    raw_material: {
                        id: 11,
                        name: "RM B",
                        barcode: "RM-B",
                        unit_raw_material: { name: "KG" },
                        raw_mat_category: { name: "Cat" },
                        supplier_materials: [{ supplier_id: 7, min_buy: 5, is_preferred: true }],
                    },
                }),
                buildDraft({ id: 3, raw_mat_id: 10, month: 7, year: 2026, quantity: 200 }),
            ];
            const create = vi
                .fn()
                .mockResolvedValueOnce({ id: 601 })
                .mockResolvedValueOnce({ id: 602 });
            const tx = buildTx(drafts, create);
            // resolveSupplierAndPrice is called once per draft (3 times) → it does
            // findFirst (preferred) and findFirst (price). Configure repeatable mock:
            tx.supplierMaterial.findFirst = vi.fn().mockResolvedValue({ supplier_id: 7, unit_price: 1000 });
            // @ts-ignore
            prisma.$transaction = vi.fn(async (cb) => cb(tx));

            const result = await RecomendationV2Service.createOpenPosFromDrafts([1, 2, 3], userId);

            expect(create).toHaveBeenCalledTimes(2);
            expect(result.created_po_ids).toEqual([601, 602]);
            const itemsCounts = create.mock.calls.map((c: any) => c[0].data.items.create.length).sort();
            expect(itemsCounts).toEqual([1, 2]);
            expect(result.affected_draft_ids.sort()).toEqual([1, 2, 3]);
        });

        it("uses the longest item lead time for grouped PO ETA", async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date("2026-06-10T00:00:00.000Z"));
            const drafts = [
                buildDraft({ id: 1, raw_mat_id: 10 }),
                buildDraft({ id: 2, raw_mat_id: 11 }),
            ];
            const create = vi.fn().mockResolvedValue({ id: 901 });
            const tx = buildTx(drafts, create);
            tx.supplierMaterial.findFirst = vi
                .fn()
                .mockResolvedValueOnce({ supplier_id: 7, unit_price: 1000 })
                .mockResolvedValueOnce({ unit_price: 1000, lead_time: 7 })
                .mockResolvedValueOnce({ supplier_id: 7, unit_price: 1000 })
                .mockResolvedValueOnce({ unit_price: 1000, lead_time: 21 });
            // @ts-ignore
            prisma.$transaction = vi.fn(async (cb) => cb(tx));

            await RecomendationV2Service.createOpenPosFromDrafts([1, 2], userId);

            expect(tx.purchaseTracking.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    po_id: 901,
                    eta_date: new Date("2026-07-01T00:00:00.000Z"),
                }),
            });
        });

        it("returns empty result when no eligible drafts (DRAFT/ACC) are found", async () => {
            const create = vi.fn();
            const tx = buildTx([], create);
            // @ts-ignore
            prisma.$transaction = vi.fn(async (cb) => cb(tx));

            const result = await RecomendationV2Service.createOpenPosFromDrafts([99], userId);

            expect(create).not.toHaveBeenCalled();
            expect(result.created_po_ids).toEqual([]);
            expect(result.affected_draft_ids).toEqual([]);
            expect(result.skipped_draft_ids).toEqual([]);
        });

        it("backfills PO for already-ACC draft that has no existing open PO", async () => {
            const draft = buildDraft({ id: 42, status: "ACC" });
            const create = vi.fn().mockResolvedValue({ id: 801 });
            const tx = buildTx([draft], create);
            // @ts-ignore
            prisma.$transaction = vi.fn(async (cb) => cb(tx));

            const result = await RecomendationV2Service.createOpenPosFromDrafts([42], userId);

            expect(create).toHaveBeenCalledTimes(1);
            expect(result.created_po_ids).toEqual([801]);
            expect(result.affected_draft_ids).toEqual([42]);
            expect(result.skipped_draft_ids).toEqual([]);
        });

        it("skips drafts whose raw_mat+month already has an OPEN PO", async () => {
            const draft = buildDraft({ id: 10, raw_mat_id: 10, month: 6, year: 2026, status: "ACC" });
            const create = vi.fn();
            // Existing PO line covers this draft's (raw_mat_id=10, year=2026, month=6)
            const tx = buildTx([draft], create, 0, [
                { raw_material_id: 10, month: 6, year: 2026 },
            ]);
            // @ts-ignore
            prisma.$transaction = vi.fn(async (cb) => cb(tx));

            const result = await RecomendationV2Service.createOpenPosFromDrafts([10], userId);

            expect(create).not.toHaveBeenCalled();
            expect(result.created_po_ids).toEqual([]);
            expect(result.affected_draft_ids).toEqual([]);
            expect(result.skipped_draft_ids).toEqual([10]);
        });

        it("throws when a draft's raw material has no preferred supplier (rollback batch)", async () => {
            const draft = buildDraft();
            const create = vi.fn();
            const tx = buildTx([draft], create);
            tx.supplierMaterial.findFirst = vi.fn().mockResolvedValue(null);
            // @ts-ignore
            prisma.$transaction = vi.fn(async (cb) => cb(tx));

            await expect(
                RecomendationV2Service.createOpenPosFromDrafts([1], userId),
            ).rejects.toThrow(/preferred supplier/i);
            expect(create).not.toHaveBeenCalled();
        });

        it("retries on P2002 po_number collision", async () => {
            const draft = buildDraft();
            const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
                code: "P2002",
                clientVersion: "test",
                meta: { target: ["po_number"] },
            });
            const create = vi.fn().mockRejectedValueOnce(p2002).mockResolvedValue({ id: 701 });
            // @ts-ignore
            prisma.$transaction = vi.fn(async (cb) => cb(buildTx([draft], create)));

            const result = await RecomendationV2Service.createOpenPosFromDrafts([1], userId);

            expect(create).toHaveBeenCalledTimes(2);
            expect(result.created_po_ids).toEqual([701]);
        });
    });

    describe("listSuppliersForMaterial - supplier identity masking", () => {
        it("masks supplier identity in listSuppliersForMaterial response", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([
                {
                    supplier_id: 42,
                    unit_price: 1000,
                    is_preferred: true,
                    supplier: { id: 42, name: "PT Real Vendor", country: "ID" },
                },
                {
                    supplier_id: 1000,
                    unit_price: 2000,
                    is_preferred: false,
                    supplier: { id: 1000, name: "PT Other Vendor", country: "SG" },
                },
            ]);
            // @ts-ignore
            prisma.supplierMaterial = { findMany: mockFindMany };

            const result = await RecomendationV2Service.listSuppliersForMaterial(7);

            expect(result[0]!.supplier_name).toBe("SUP-042");
            expect(result[1]!.supplier_name).toBe("SUP1000");
            for (const r of result) {
                expect(r.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
                expect(r.supplier_name).toHaveLength(7);
                expect(r.supplier_name).not.toContain("Vendor");
            }
        });
    });
});
