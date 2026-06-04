import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RecomendationV2Service } from "../module/application/recomendation-v2/recomendation-v2.service.js";
import prisma from "../config/prisma.js";
import { Prisma } from "../generated/prisma/client.js";

describe("RecomendationV2Service - Override Features", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
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
            prisma.$queryRaw.mockResolvedValueOnce([]); // earliestPo (MIN order_date)
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
    });
});
