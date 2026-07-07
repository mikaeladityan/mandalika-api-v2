import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../../config/prisma.js";
import { ForecastService } from "../../module/application/forecast/forecast.service.js";

// ─── Mock data ─────────────────────────────────────────────────────────────────

const mockProducts = [
    {
        id: 1,
        name: "EDP 110ml",
        distribution_percentage: "50.00",
        product_type: { slug: "edp" },
        size: { size: 110 },
    },
    {
        id: 2,
        name: "EDP 110ml",
        distribution_percentage: "50.00",
        product_type: { slug: "parfum" },
        size: { size: 110 },
    },
];

describe("ForecastService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("get", () => {
        it("should return forecast list with correct len", async () => {
            (prisma.product.count as any).mockResolvedValue(1);
            (prisma.$queryRaw as any).mockResolvedValue([
                {
                    id: 1,
                    code: "P001",
                    name: "Product 1",
                    z_value: 1.65,
                    size: 110,
                    product_type_name: "EDP",
                    unit_name: "pcs",
                    distribution_percentage: null,
                    reference_distribution_percentage: 0.35,
                    safety_percentage: null,
                    forecasts_data: "[]",
                    safety_stock_data: null,
                    historical_sales_data: "[]",
                    stock_by_warehouse_data: JSON.stringify([
                        { warehouse_id: 10, warehouse_name: "GFG-SBY", stock: 250 },
                        { warehouse_id: 11, warehouse_name: "GFG-JKT", stock: 0 },
                    ]),
                    current_stock: 250,
                },
            ]);

            // @ts-ignore
            prisma.forecastPercentage.findMany.mockResolvedValue([]);

            const result = await ForecastService.get({ page: 1, take: 25 });

            expect(result.len).toBe(1);
            expect(result.data).toHaveLength(1);
            expect(result.data[0]!.product_code).toBe("P001");
            // DB fraction 0.35 → respons persen 35 (konsisten dengan distribution_percentage)
            expect(result.data[0]!.reference_distribution_percentage).toBe(35);

            const wh = result.data[0]!.stock_by_warehouse;
            expect(wh).toHaveLength(2);
            expect(wh[0]).toEqual({
                warehouse_id: 10,
                warehouse_name: "GFG-SBY",
                stock: 250,
            });
            expect(wh[1]!.stock).toBe(0);
        });

        it("should default stock_by_warehouse to [] when raw is null", async () => {
            (prisma.product.count as any).mockResolvedValue(1);
            (prisma.$queryRaw as any).mockResolvedValue([
                {
                    id: 2,
                    code: "P002",
                    name: "Product 2",
                    z_value: 1.65,
                    size: 110,
                    product_type_name: "EDP",
                    unit_name: "pcs",
                    distribution_percentage: null,
                    safety_percentage: null,
                    forecasts_data: "[]",
                    safety_stock_data: null,
                    historical_sales_data: "[]",
                    stock_by_warehouse_data: null,
                    current_stock: 0,
                },
            ]);
            // @ts-ignore
            prisma.forecastPercentage.findMany.mockResolvedValue([]);

            const result = await ForecastService.get({ page: 1, take: 25 });
            expect(result.data[0]!.stock_by_warehouse).toEqual([]);
            expect(result.data[0]!.edar_sales_share).toBeNull();
            // No EDAR rows on the page -> pair query must be skipped
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        });
    });

    describe("get - edar_sales_share", () => {
        const baseRaw = {
            z_value: 1.65,
            size: 110,
            size_id: 5,
            product_type_name: "EDP",
            unit_name: "pcs",
            safety_percentage: null,
            forecasts_data: "[]",
            safety_stock_data: null,
            historical_sales_data: "[]",
            stock_by_warehouse_data: null,
            current_stock: 0,
        };

        const pairMember = (
            id: number,
            code: string,
            type: string,
            sales: number,
        ) => ({
            id,
            code,
            name: "GORGEOUS TUBEROSE",
            size_id: 5,
            product_type_name: type,
            distribution_percentage: 0.5,
            sales,
        });

        beforeEach(() => {
            // @ts-ignore
            prisma.forecastPercentage.findMany.mockResolvedValue([]);
        });

        it("splits pair sales share 70/30 across members", async () => {
            (prisma.product.count as any).mockResolvedValue(2);
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([
                    {
                        ...baseRaw,
                        id: 1,
                        code: "PW110E-GOR",
                        name: "GORGEOUS TUBEROSE",
                        distribution_percentage: 0.5,
                    },
                    {
                        ...baseRaw,
                        id: 2,
                        code: "PW110P-GOR",
                        name: "GORGEOUS TUBEROSE",
                        product_type_name: "Parfum",
                        distribution_percentage: 0.5,
                    },
                ])
                .mockResolvedValueOnce([
                    pairMember(1, "PW110E-GOR", "EDP", 7),
                    pairMember(2, "PW110P-GOR", "Parfum", 3),
                ]);

            const result = await ForecastService.get({ page: 1, take: 25 });

            const edp = result.data.find((d) => d.product_id === 1)!.edar_sales_share!;
            expect(edp.own_sales).toBe(7);
            expect(edp.pair_total_sales).toBe(10);
            expect(edp.actual_pct).toBe(70);
            expect(edp.members).toHaveLength(2);
            expect(edp.members[0]!.edar_pct).toBe(50);

            const parfum = result.data.find((d) => d.product_id === 2)!.edar_sales_share!;
            expect(parfum.actual_pct).toBe(30);
        });

        it("includes pair member outside the current page in the total", async () => {
            (prisma.product.count as any).mockResolvedValue(1);
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([
                    {
                        ...baseRaw,
                        id: 1,
                        code: "PW110E-GOR",
                        name: "GORGEOUS TUBEROSE",
                        distribution_percentage: 0.5,
                    },
                ])
                .mockResolvedValueOnce([
                    pairMember(1, "PW110E-GOR", "EDP", 7),
                    pairMember(2, "PW110P-GOR", "Parfum", 3),
                ]);

            const result = await ForecastService.get({ page: 1, take: 25 });

            const share = result.data[0]!.edar_sales_share!;
            expect(share.actual_pct).toBe(70);
            expect(share.pair_total_sales).toBe(10);
            expect(share.members).toHaveLength(2);
        });

        it("returns null actual_pct when pair total sales is zero", async () => {
            (prisma.product.count as any).mockResolvedValue(1);
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([
                    {
                        ...baseRaw,
                        id: 1,
                        code: "PW110E-GOR",
                        name: "GORGEOUS TUBEROSE",
                        distribution_percentage: 0.5,
                    },
                ])
                .mockResolvedValueOnce([
                    pairMember(1, "PW110E-GOR", "EDP", 0),
                    pairMember(2, "PW110P-GOR", "Parfum", 0),
                ]);

            const result = await ForecastService.get({ page: 1, take: 25 });

            const share = result.data[0]!.edar_sales_share!;
            expect(share.actual_pct).toBeNull();
            expect(share.pair_total_sales).toBe(0);
        });

        it("returns 100% when the pair has a single member", async () => {
            (prisma.product.count as any).mockResolvedValue(1);
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([
                    {
                        ...baseRaw,
                        id: 1,
                        code: "PW110E-GOR",
                        name: "GORGEOUS TUBEROSE",
                        distribution_percentage: 0.5,
                    },
                ])
                .mockResolvedValueOnce([pairMember(1, "PW110E-GOR", "EDP", 5)]);

            const result = await ForecastService.get({ page: 1, take: 25 });

            expect(result.data[0]!.edar_sales_share!.actual_pct).toBe(100);
        });
    });

    // Note: Other tests (run, detail, finalize, destroy) are temporarily disabled 
    // due to significant architecture changes in the forecasting engine.
    // They need to be refactored to match the variant-based pooling logic.
});
