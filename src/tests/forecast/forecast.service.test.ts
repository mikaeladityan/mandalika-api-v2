import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../../config/prisma.js";
import { escapeIlike, ForecastService } from "../../module/application/forecast/forecast.service.js";
import {
    QueryInventoryTurnoverRMSchema,
    QueryInventoryTurnoverSchema,
} from "../../module/application/forecast/forecast.schema.js";

// ─── Mock data ─────────────────────────────────────────────────────────────────

const mockProducts = [
    {
        id: 1,
        name: "EXT 110ml",
        distribution_percentage: "50.00",
        product_type: { slug: "ext" },
        size: { size: 110 },
    },
    {
        id: 2,
        name: "EXT 110ml",
        distribution_percentage: "50.00",
        product_type: { slug: "parfum" },
        size: { size: 110 },
    },
];

describe("ForecastService", () => {
    it("accepts unavailable status in FG and RM filters", () => {
        expect(QueryInventoryTurnoverSchema.parse({ status: "TIDAK_TERSEDIA" }).status).toBe("TIDAK_TERSEDIA");
        expect(QueryInventoryTurnoverRMSchema.parse({ status: "TIDAK_TERSEDIA" }).status).toBe("TIDAK_TERSEDIA");
    });

    it("escapes PostgreSQL ILIKE wildcards and backslashes", () => {
        expect(escapeIlike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    });
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("calculateInventoryTurnover", () => {
        it("matches the PERPUTARAN STOK workbook example", () => {
            const result = ForecastService.calculateInventoryTurnover({
                stock: 107_612,
                averageMonthlyUsage: 95_466,
                forecast: 104_900,
                leadTimeDays: 15,
            });

            expect(result.historical_coverage).toBeCloseTo(1.1272285, 7);
            expect(result.forecast_coverage).toBeCloseTo(1.0258532, 7);
            expect(result.days_inventory).toBeCloseTo(30.7756, 4);
            expect(result.annual_turnover).toBeCloseTo(11.69758, 5);
            expect(result.lead_time_months).toBe(0.5);
            expect(result.target_coverage).toBe(1.5);
            expect(result.status).toBe("TIPIS");
            expect(result.excess_stock).toBe(0);
        });

        it("calculates coverage, turnover, status, and excess stock", () => {
            const result = ForecastService.calculateInventoryTurnover({
                stock: 185_815,
                averageMonthlyUsage: 25_715,
                forecast: 20_000,
                leadTimeDays: 75,
            });

            expect(result.forecast_coverage).toBeCloseTo(9.29075);
            expect(result.days_inventory).toBeCloseTo(278.7225);
            expect(result.annual_turnover).toBeCloseTo(1.2916, 4);
            expect(result.target_coverage).toBe(3.5);
            expect(result.status).toBe("BERLEBIH");
            expect(result.excess_stock).toBe(45_815);
        });

        it("classifies empty and non-moving stock from stock and forecast", () => {
            expect(
                ForecastService.calculateInventoryTurnover({
                    stock: 0,
                    averageMonthlyUsage: 420,
                    forecast: 900,
                    leadTimeDays: 15,
                }).status,
            ).toBe("KOSONG");
            const stopped = ForecastService.calculateInventoryTurnover({
                stock: 25_000,
                averageMonthlyUsage: 500,
                forecast: 0,
                leadTimeDays: 30,
            });
            expect(stopped.status).toBe("TIDAK_BERGERAK");
            expect(stopped.forecast_coverage).toBeNull();
            expect(stopped.annual_turnover).toBeNull();

            const noHistoricalUsage = ForecastService.calculateInventoryTurnover({
                stock: 100,
                averageMonthlyUsage: 0,
                forecast: 100,
                leadTimeDays: 30,
            });
            expect(noHistoricalUsage.historical_coverage).toBeNull();
            expect(noHistoricalUsage.status).toBe("TIPIS");
        });

        it("marks unavailable coverage explicitly when stock and forecast are non-positive", () => {
            expect(ForecastService.calculateInventoryTurnover({
                stock: 0,
                averageMonthlyUsage: 0,
                forecast: 0,
                leadTimeDays: 15,
            }).status).toBe("TIDAK_TERSEDIA");
            expect(ForecastService.calculateInventoryTurnover({
                stock: -10,
                averageMonthlyUsage: 0,
                forecast: -20,
                leadTimeDays: 15,
            }).status).toBe("TIDAK_TERSEDIA");
        });

        it("keeps workbook empty and non-moving classifications ahead of unavailable", () => {
            expect(ForecastService.calculateInventoryTurnover({
                stock: 0,
                averageMonthlyUsage: 0,
                forecast: 10,
                leadTimeDays: 15,
            }).status).toBe("KOSONG");
            expect(ForecastService.calculateInventoryTurnover({
                stock: 10,
                averageMonthlyUsage: 0,
                forecast: 0,
                leadTimeDays: 15,
            }).status).toBe("TIDAK_BERGERAK");
        });

        it("keeps ratios but marks a missing lead time unavailable", () => {
            const result = ForecastService.calculateInventoryTurnover({
                stock: 100,
                averageMonthlyUsage: 20,
                forecast: 40,
                leadTimeDays: null,
            });

            expect(result.historical_coverage).toBe(5);
            expect(result.forecast_coverage).toBe(2.5);
            expect(result.lead_time_months).toBeNull();
            expect(result.target_coverage).toBeNull();
            expect(result.status).toBe("TIDAK_TERSEDIA");
            expect(result.excess_stock).toBe(0);
        });

        it("keeps empty and non-moving precedence when lead time is missing", () => {
            expect(ForecastService.calculateInventoryTurnover({
                stock: 0,
                averageMonthlyUsage: 10,
                forecast: 10,
                leadTimeDays: null,
            }).status).toBe("KOSONG");
            expect(ForecastService.calculateInventoryTurnover({
                stock: 10,
                averageMonthlyUsage: 10,
                forecast: 0,
                leadTimeDays: null,
            }).status).toBe("TIDAK_BERGERAK");
        });
    });

    describe("calculateInventoryTurnoverRM", () => {
        it("keeps RM ratios null when demand or stock is zero", () => {
            expect(ForecastService.calculateInventoryTurnoverRM(100, 0)).toEqual({
                coverage_months: null,
                annual_turnover: null,
                days_inventory: null,
            });
            expect(ForecastService.calculateInventoryTurnoverRM(0, 10)).toEqual({
                coverage_months: 0,
                annual_turnover: null,
                days_inventory: 0,
            });
        });

        it("aggregates RM summary independently of pagination", () => {
            expect(ForecastService.calculateInventoryTurnoverRMSummary([
                { stock_rm: 100, demand_rm: 20 },
                { stock_rm: 50, demand_rm: 10 },
            ])).toEqual({
                total_stock_rm: 150,
                total_demand_rm: 30,
                coverage_months: 5,
                annual_turnover: 2.4,
                days_inventory: 150,
            });
            expect(ForecastService.calculateInventoryTurnoverRMSummary([])).toEqual({
                total_stock_rm: 0,
                total_demand_rm: 0,
                coverage_months: null,
                annual_turnover: null,
                days_inventory: null,
            });
        });
    });

    describe("inventoryTurnoverRM", () => {
        it("uses historical usage for RM summary turnover while rows remain forecast based", () => {
            const row = ForecastService.calculateInventoryTurnover({
                stock: 100,
                averageMonthlyUsage: 20,
                forecast: 40,
                leadTimeDays: 30,
            });
            const summary = ForecastService.calculateInventoryTurnoverRMSummaryParity([
                { stock_rm: 100, average_monthly_usage_rm: 20, demand_rm: 40, excess_stock: row.excess_stock },
                { stock_rm: 50, average_monthly_usage_rm: 10, demand_rm: 10, excess_stock: 0 },
            ]);

            expect(row.annual_turnover).toBe(4.8);
            expect(summary.historical_coverage).toBe(5);
            expect(summary.forecast_coverage).toBe(3);
            expect(summary.annual_turnover).toBe(2.4);
        });

        it("calculates RM parity metrics with lead time and status", () => {
            const result = ForecastService.calculateInventoryTurnover({
                stock: 120,
                averageMonthlyUsage: 30,
                forecast: 40,
                leadTimeDays: 60,
            });
            expect(result.historical_coverage).toBe(4);
            expect(result.forecast_coverage).toBe(3);
            expect(result.lead_time_months).toBe(2);
            expect(result.target_coverage).toBe(3);
            expect(result.status).toBe("SEHAT");
            expect(result.excess_stock).toBe(0);
        });

        it("casts snapshot periods to integers for PostgreSQL comparisons", async () => {
            (prisma.$queryRaw as any).mockResolvedValueOnce([]);

            await ForecastService.inventoryTurnoverRM({ month: 9, year: 2026, page: 1, take: 50 });

            const sql = (prisma.$queryRaw as any).mock.calls[0]?.[0] as { strings?: readonly string[] };
            const source = sql.strings?.join(" ");
            expect(source).toContain("::integer");
            expect(source).toContain("product_issuances");
            expect(source).toContain("use_size_calc");
            expect(source).toContain("is_preferred DESC");
            expect(source).toContain("sm.lead_time IS NOT NULL");
            expect(source).not.toContain("COALESCE(policy.lead_time, 0)");
            expect(source).toContain("COALESCE(issuance.quantity");
            // Forecast RM must average 4 forward months (M0..M+3), not a single selected-month value.
            expect(source).toContain("forecast_period");
            expect(source).toContain("AVG(monthly.quantity)::numeric AS demand_rm");

            // period for month=9,year=2026 is 2026*12+9; forecast periods must cover M0..M+3.
            const serialized = JSON.stringify((prisma.$queryRaw as any).mock.calls[0]?.[0]);
            const period = 2026 * 12 + 9;
            for (const forward of [period, period + 1, period + 2, period + 3]) {
                expect(serialized).toContain(String(forward));
            }
        });

        it("passes a missing RM lead time through to workbook calculations", async () => {
            (prisma.$queryRaw as any).mockResolvedValueOnce([{
                raw_material_id: 1,
                barcode: "RM-1",
                name: "Material",
                unit: "kg",
                stock_rm: 100,
                average_monthly_usage_rm: 20,
                demand_rm: 40,
                lead_time_days: null,
            }]);

            const result = await ForecastService.inventoryTurnoverRM({ month: 9, year: 2026, page: 1, take: 50 });

            expect(result.data[0]).toMatchObject({
                lead_time_days: null,
                lead_time_months: null,
                target_coverage: null,
                status: "TIDAK_TERSEDIA",
                excess_stock: 0,
            });
        });

        it("exports unavailable RM lead-time values as dashes", async () => {
            (prisma.$queryRaw as any).mockResolvedValueOnce([{
                raw_material_id: 1,
                barcode: "RM-1",
                name: "Material",
                unit: "kg",
                stock_rm: 100,
                average_monthly_usage_rm: 20,
                demand_rm: 40,
                lead_time_days: null,
            }]);

            const csv = (await ForecastService.exportInventoryTurnoverRM({ month: 9, year: 2026 })).toString("utf-8");

            expect(csv).toContain("RM-1,Material (kg),100,20,40,5,2.5,75,4.8,-,-,TIDAK TERSEDIA,0");
        });
    });

    describe("inventoryTurnover", () => {
        it("uses forecast coverage for summary days and historical coverage for summary turnover", async () => {
            (prisma.$queryRaw as any).mockResolvedValueOnce([{
                product_id: 1,
                product_code: "FG-1",
                product_name: "FG 1",
                lead_time: 30,
                stock: 100,
                average_monthly_usage: 20,
                forecast: 40,
            }]);

            const result = await ForecastService.inventoryTurnover({ month: 9, year: 2026, page: 1, take: 50 });

            expect(result.data[0]!.annual_turnover).toBe(4.8);
            expect(result.summary.historical_coverage).toBe(5);
            expect(result.summary.forecast_coverage).toBe(2.5);
            expect(result.summary.days_inventory).toBe(75);
            expect(result.summary.annual_turnover).toBe(2.4);
        });

        it("casts inventory snapshot and issuance periods to integers", async () => {
            (prisma.$queryRaw as any).mockResolvedValueOnce([]);

            await ForecastService.inventoryTurnover({ month: 9, year: 2026, page: 1, take: 50 });

            const sql = (prisma.$queryRaw as any).mock.calls[0]?.[0] as { strings?: readonly string[] };
            const source = sql.strings?.join(" ");
            expect(source).toContain("snapshot.period::integer");
            expect(source).toContain("usage_period.period::integer");
            expect(source).toContain("::integer)");
        });
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
                    product_type_name: "EXT",
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
                    product_type_name: "EXT",
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
            product_type_name: "EXT",
            unit_name: "pcs",
            safety_percentage: null,
            forecasts_data: "[]",
            safety_stock_data: null,
            historical_sales_data: "[]",
            stock_by_warehouse_data: null,
            current_stock: 0,
        };

        // Pair query sekarang mengembalikan sales per bulan (window AVG ACT);
        // fixture memakai bulan ACT terakhir = bulan sebelum start window (now).
        const lastAct = (() => {
            const n = new Date();
            const d = new Date(n.getFullYear(), n.getMonth() - 1, 1);
            return { month: d.getMonth() + 1, year: d.getFullYear() };
        })();

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
            year: lastAct.year,
            month: lastAct.month,
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
                    pairMember(1, "PW110E-GOR", "EXT", 7),
                    pairMember(2, "PW110P-GOR", "Parfum", 3),
                ]);

            const result = await ForecastService.get({ page: 1, take: 25 });

            const ext = result.data.find((d) => d.product_id === 1)!.edar_sales_share!;
            expect(ext.own_sales).toBe(7);
            expect(ext.pair_total_sales).toBe(10);
            expect(ext.actual_pct).toBe(70);
            expect(ext.members).toHaveLength(2);
            expect(ext.members[0]!.edar_pct).toBe(50);

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
                    pairMember(1, "PW110E-GOR", "EXT", 7),
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
                    pairMember(1, "PW110E-GOR", "EXT", 0),
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
                .mockResolvedValueOnce([pairMember(1, "PW110E-GOR", "EXT", 5)]);

            const result = await ForecastService.get({ page: 1, take: 25 });

            expect(result.data[0]!.edar_sales_share!.actual_pct).toBe(100);
        });
    });

    // Note: Other tests (run, detail, finalize, destroy) are temporarily disabled 
    // due to significant architecture changes in the forecasting engine.
    // They need to be refactored to match the variant-based pooling logic.
});
