import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    QueryForecastAccuracySchema,
    ResponseForecastAccuracySchema,
} from "../../module/application/forecast/accuracy/accuracy.schema.js";
import { ForecastAccuracyService } from "../../module/application/forecast/accuracy/accuracy.service.js";
import prisma from "../../config/prisma.js";

vi.mock("../../config/prisma.js", () => ({
    default: {
        $queryRaw: vi.fn(),
    },
}));

describe("accuracy.schema", () => {
    describe("QueryForecastAccuracySchema", () => {
        it("coerces numeric query string values", () => {
            const parsed = QueryForecastAccuracySchema.parse({
                month: "5",
                year: "2026",
                page: "2",
                take: "50",
            });
            expect(parsed.month).toBe(5);
            expect(parsed.year).toBe(2026);
            expect(parsed.page).toBe(2);
            expect(parsed.take).toBe(50);
            expect(parsed.is_others).toBe(false);
        });

        it("treats month/year as optional (no defaults)", () => {
            const parsed = QueryForecastAccuracySchema.parse({});
            expect(parsed.month).toBeUndefined();
            expect(parsed.year).toBeUndefined();
            expect(parsed.page).toBe(1);
            expect(parsed.take).toBe(25);
        });

        it("defaults tolerance to 25 and coerces string values", () => {
            expect(QueryForecastAccuracySchema.parse({}).tolerance).toBe(25);
            expect(QueryForecastAccuracySchema.parse({ tolerance: "10" }).tolerance).toBe(10);
            expect(QueryForecastAccuracySchema.parse({ tolerance: "0.5" }).tolerance).toBe(0.5);
        });

        it("rejects tolerance outside 0.5..50", () => {
            expect(() => QueryForecastAccuracySchema.parse({ tolerance: "0.4" })).toThrow();
            expect(() => QueryForecastAccuracySchema.parse({ tolerance: "51" })).toThrow();
        });

        it("rejects month outside 1..12", () => {
            expect(() => QueryForecastAccuracySchema.parse({ month: "0", year: "2026" })).toThrow();
            expect(() => QueryForecastAccuracySchema.parse({ month: "13", year: "2026" })).toThrow();
        });

        it("rejects take > 500", () => {
            expect(() => QueryForecastAccuracySchema.parse({ take: "501" })).toThrow();
        });

        it("parses is_others string variants correctly", () => {
            expect(QueryForecastAccuracySchema.parse({ is_others: "true" }).is_others).toBe(true);
            expect(QueryForecastAccuracySchema.parse({ is_others: "false" }).is_others).toBe(false);
            expect(QueryForecastAccuracySchema.parse({ is_others: "1" }).is_others).toBe(true);
            expect(QueryForecastAccuracySchema.parse({ is_others: "0" }).is_others).toBe(false);
            expect(QueryForecastAccuracySchema.parse({}).is_others).toBe(false);
        });
    });

    describe("ResponseForecastAccuracySchema", () => {
        it("accepts a well-formed response", () => {
            const ok = ResponseForecastAccuracySchema.parse({
                period: { month: 5, year: 2026 },
                tolerance: 25,
                summary: {
                    total_forecast: 100,
                    total_sales: 95,
                    accuracy_percentage: "94.74%",
                    bias_percentage: "105.26%",
                    product_count: 1,
                    excluded_count: 0,
                    accurate_count: 1,
                    under_count: 0,
                    over_count: 0,
                },
                data: [
                    {
                        product_id: 1,
                        product_code: "X",
                        product_name: "Test",
                        product_type: "EDP",
                        product_size: "100 pcs",
                        forecast: 100,
                        sales: 95,
                        diff: 5,
                        accuracy_percentage: "105.26%",
                        accuracy_status: "tepat_sasaran",
                    },
                ],
                len: 1,
            });
            expect(ok.data[0]?.accuracy_status).toBe("tepat_sasaran");
        });

        it("accepts accuracy above 100% (over-forecast ratio)", () => {
            const item = {
                product_id: 1,
                product_code: null,
                product_name: "Test",
                product_type: "",
                product_size: "",
                forecast: 300,
                sales: 100,
                diff: 200,
                accuracy_percentage: "300.00%",
                accuracy_status: "over",
            };
            expect(() =>
                ResponseForecastAccuracySchema.shape.data.element.parse(item),
            ).not.toThrow();
        });
    });
});

describe("ForecastAccuracyService.formatAccuracy", () => {
    const fmt = ForecastAccuracyService.formatAccuracy;

    it("returns 100.00% when forecast equals sales", () => {
        expect(fmt(100, 100)).toBe("100.00%");
    });

    it("returns ratio above 100% when forecast exceeds sales", () => {
        // 320/310 × 100 = 103.2258…% → "103.23%"
        expect(fmt(320, 310)).toBe("103.23%");
    });

    it("does not clamp large over-forecast ratios", () => {
        expect(fmt(1000, 100)).toBe("1000.00%");
    });

    it("returns ratio below 100% when forecast is under sales", () => {
        // 75/100 → "75.00%"
        expect(fmt(75, 100)).toBe("75.00%");
    });

    it("returns N/A when sales is 0", () => {
        expect(fmt(50, 0)).toBe("N/A");
    });

    it("returns N/A when sales is negative (defensive)", () => {
        expect(fmt(50, -5)).toBe("N/A");
    });

    it("returns 0.00% when forecast is 0 and sales is positive", () => {
        expect(fmt(0, 1)).toBe("0.00%");
    });
});

describe("ForecastAccuracyService.resolvePeriod", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns explicit month/year unchanged", async () => {
        const result = await ForecastAccuracyService.resolvePeriod({
            month: 3,
            year: 2026,
            is_others: false,
            tolerance: 25,
            page: 1,
            take: 25,
        });
        expect(result).toEqual({ month: 3, year: 2026 });
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("falls back to most recent period with sales when both missing", async () => {
        // @ts-ignore — mock
        prisma.$queryRaw.mockResolvedValueOnce([{ month: 4, year: 2026 }]);
        const result = await ForecastAccuracyService.resolvePeriod({
            is_others: false,
            tolerance: 25,
            page: 1,
            take: 25,
        });
        expect(result).toEqual({ month: 4, year: 2026 });
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("treats partial input (only month) as missing → fallback", async () => {
        // @ts-ignore
        prisma.$queryRaw.mockResolvedValueOnce([{ month: 4, year: 2026 }]);
        const result = await ForecastAccuracyService.resolvePeriod({
            month: 5, // year missing → guard fails, fallback path executes
            is_others: false,
            tolerance: 25,
            page: 1,
            take: 25,
        });
        expect(result).toEqual({ month: 4, year: 2026 });
    });

    it("falls back to current month/year when no period has sales", async () => {
        // @ts-ignore
        prisma.$queryRaw.mockResolvedValueOnce([]);
        const now = new Date();
        const result = await ForecastAccuracyService.resolvePeriod({
            is_others: false,
            tolerance: 25,
            page: 1,
            take: 25,
        });
        expect(result).toEqual({
            month: now.getUTCMonth() + 1,
            year: now.getUTCFullYear(),
        });
    });
});

describe("ForecastAccuracyService.list", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const aggRow = {
        product_count: 2,
        total_forecast: "320",
        total_sales: "310",
        excluded_count: 1,
        wmape_accuracy: "96.77",
        bias_pct: "103.23",
        accurate_count: 1,
        under_count: 0,
        over_count: 0,
    };

    it("returns per-product rows with ratio accuracy and 3-tier status", async () => {
        // First $queryRaw call = page rows, second = aggregate
        // @ts-ignore
        (prisma.$queryRaw as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce([
                {
                    product_id: 1,
                    product_code: "EDP-AZUR-100",
                    product_name: "AZURE",
                    product_type_name: "EDP",
                    size: 100,
                    unit_name: "pcs",
                    forecast: "320",
                    sales: "310",
                },
                {
                    product_id: 2,
                    product_code: "EDP-NOVA-100",
                    product_name: "NOVA",
                    product_type_name: "EDP",
                    size: 100,
                    unit_name: "pcs",
                    forecast: "150",
                    sales: "0",
                },
                {
                    product_id: 3,
                    product_code: "EDP-LUNA-100",
                    product_name: "LUNA",
                    product_type_name: "EDP",
                    size: 100,
                    unit_name: "pcs",
                    forecast: "50",
                    sales: "100",
                },
                {
                    product_id: 4,
                    product_code: "EDP-SOLA-100",
                    product_name: "SOLA",
                    product_type_name: "EDP",
                    size: 100,
                    unit_name: "pcs",
                    forecast: "300",
                    sales: "100",
                },
            ])
            .mockResolvedValueOnce([aggRow]);

        const result = await ForecastAccuracyService.list({
            month: 5,
            year: 2026,
            is_others: false,
            tolerance: 25,
            page: 1,
            take: 25,
        });

        expect(result.period).toEqual({ month: 5, year: 2026 });
        expect(result.tolerance).toBe(25);

        const [azure, nova, luna, sola] = result.data as [any, any, any, any];

        // 320/310 = 103.23% → inside 75–125 band
        expect(azure.accuracy_percentage).toBe("103.23%");
        expect(azure.accuracy_status).toBe("tepat_sasaran");
        expect(azure.diff).toBe(10);

        // sales 0 → no data
        expect(nova.accuracy_percentage).toBe("N/A");
        expect(nova.accuracy_status).toBeNull();

        // 50/100 = 50% → under
        expect(luna.accuracy_status).toBe("under");

        // 300/100 = 300% → over
        expect(sola.accuracy_status).toBe("over");

        expect(result.summary.accuracy_percentage).toBe("96.77%");
        expect(result.summary.bias_percentage).toBe("103.23%");
        expect(result.summary.accurate_count).toBe(1);
    });

    it("respects a custom tolerance for per-item status", async () => {
        // @ts-ignore
        (prisma.$queryRaw as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce([
                {
                    product_id: 1,
                    product_code: "X",
                    product_name: "TIGHT",
                    product_type_name: "EDP",
                    size: 100,
                    unit_name: "pcs",
                    forecast: "110",
                    sales: "100",
                },
            ])
            .mockResolvedValueOnce([aggRow]);

        // 110% ratio: tepat sasaran at ±25, over at ±5
        const result = await ForecastAccuracyService.list({
            month: 5,
            year: 2026,
            is_others: false,
            tolerance: 5,
            page: 1,
            take: 25,
        });
        expect(result.tolerance).toBe(5);
        expect(result.data[0]?.accuracy_status).toBe("over");
    });

    it("returns empty data + N/A summary when no products match", async () => {
        // @ts-ignore
        (prisma.$queryRaw as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    product_count: 0,
                    total_forecast: null,
                    total_sales: null,
                    excluded_count: 0,
                    wmape_accuracy: null,
                    bias_pct: null,
                    accurate_count: 0,
                    under_count: 0,
                    over_count: 0,
                },
            ]);

        const result = await ForecastAccuracyService.list({
            month: 5,
            year: 2026,
            is_others: false,
            tolerance: 25,
            page: 1,
            take: 25,
        });

        expect(result.data).toEqual([]);
        expect(result.len).toBe(0);
        expect(result.summary.total_forecast).toBe(0);
        expect(result.summary.total_sales).toBe(0);
        expect(result.summary.accuracy_percentage).toBe("N/A");
        expect(result.summary.bias_percentage).toBe("N/A");
    });
});
