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
                summary: {
                    total_forecast: 100,
                    total_sales: 95,
                    accuracy_percentage: "95.00%",
                    product_count: 1,
                    excluded_count: 0,
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
                        accuracy_percentage: "95.00%",
                    },
                ],
                len: 1,
            });
            expect(ok.data[0]?.accuracy_percentage).toBe("95.00%");
        });
    });
});

describe("ForecastAccuracyService.formatAccuracy", () => {
    const fmt = ForecastAccuracyService.formatAccuracy;

    it("returns 100.00% when forecast equals sales", () => {
        expect(fmt(100, 100)).toBe("100.00%");
    });

    it("returns 96.77% for F=320 A=310", () => {
        expect(fmt(320, 310)).toBe("96.77%");
    });

    it("clamps to 0.00% when |F-A|/A > 1", () => {
        // F=1000 A=100 → |F-A|/A = 9 → 1-9 = -8 → clamp 0
        expect(fmt(1000, 100)).toBe("0.00%");
    });

    it("returns N/A when sales is 0", () => {
        expect(fmt(50, 0)).toBe("N/A");
    });

    it("returns N/A when sales is negative (defensive)", () => {
        expect(fmt(50, -5)).toBe("N/A");
    });

    it("returns 0.00% when forecast is 0 and sales is positive (no clamp needed)", () => {
        // |0-1|/1 = 1 → (1-1)*100 = 0 — hits 0 exactly without clamping
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

    it("returns per-product rows with formatted accuracy strings", async () => {
        // First $queryRaw call = page rows, second = aggregate
        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
            ])
            .mockResolvedValueOnce([
                {
                    product_count: 2,
                    total_forecast: "320",
                    total_sales: "310",
                    excluded_count: 1,
                },
            ]);

        const result = await ForecastAccuracyService.list({
            month: 5,
            year: 2026,
            is_others: false,
            page: 1,
            take: 25,
        });

        expect(result.period).toEqual({ month: 5, year: 2026 });
        expect(result.len).toBe(2);
        expect(result.data).toHaveLength(2);

        const azure = result.data[0]!;
        expect(azure.forecast).toBe(320);
        expect(azure.sales).toBe(310);
        expect(azure.diff).toBe(10);
        // (1 - 10/310) × 100 = 96.7741…% → "96.77%"
        expect(azure.accuracy_percentage).toBe("96.77%");

        const nova = result.data[1]!;
        expect(nova.sales).toBe(0);
        expect(nova.accuracy_percentage).toBe("N/A");

        expect(result.summary.total_forecast).toBe(320);
        expect(result.summary.total_sales).toBe(310);
        expect(result.summary.accuracy_percentage).toBe("96.77%");
        expect(result.summary.product_count).toBe(2);
        expect(result.summary.excluded_count).toBe(1);
    });

    it("returns empty data + N/A summary when no products match", async () => {
        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        (prisma.$queryRaw as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    product_count: 0,
                    total_forecast: null,
                    total_sales: null,
                    excluded_count: 0,
                },
            ]);

        const result = await ForecastAccuracyService.list({
            month: 5,
            year: 2026,
            is_others: false,
            page: 1,
            take: 25,
        });

        expect(result.data).toEqual([]);
        expect(result.len).toBe(0);
        expect(result.summary.total_forecast).toBe(0);
        expect(result.summary.total_sales).toBe(0);
        expect(result.summary.accuracy_percentage).toBe("N/A");
    });
});
