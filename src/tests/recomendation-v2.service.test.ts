import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RecomendationV2Service } from "../module/application/recomendation-v2/recomendation-v2.service.js";
import prisma from "../config/prisma.js";

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
            expect(result.quantity).toBe(1500);
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
});
