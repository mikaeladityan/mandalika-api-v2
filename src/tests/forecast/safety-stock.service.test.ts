import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
    forecast: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    outlet: { findMany: vi.fn() },
    outletIssuance: { findMany: vi.fn() },
}));
vi.mock("../../config/prisma.js", () => ({ default: prismaMock }));
vi.mock("../../module/application/outlet/shared/forecast-product-order.js", () => ({ orderProductIdsByForecast: vi.fn(async (ids: number[]) => ids) }));

import { SafetyStockService } from "../../module/application/forecast/safety-stock/services.js";
import { orderProductIdsByForecast } from "../../module/application/outlet/shared/forecast-product-order.js";

describe("SafetyStockService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.forecast.findMany.mockResolvedValue([{ product_id: 1, final_forecast: 0, net_forecast: 0 }, { product_id: 2, final_forecast: 0, net_forecast: 0 }]);
        prismaMock.product.findMany.mockResolvedValue([
            { id: 1, code: "ACTIVE", name: "Active", status: "ACTIVE" },
            { id: 2, code: "DISC", name: "Discontinue", status: "PENDING" },
        ]);
        prismaMock.outlet.findMany.mockResolvedValue([{ id: 1, code: "PMS", name: "PMS" }, { id: 2, code: "PMJ", name: "PMJ" }]);
        prismaMock.outletIssuance.findMany.mockResolvedValue([
            ...[11, 9, 15, 10].map((quantity, index) => ({ outlet_id: 1, product_id: 1, date: new Date(Date.UTC(2026, 4, 1 + index * 7)), quantity })),
            ...[11, 9, 15, 10].map((quantity, index) => ({ outlet_id: 2, product_id: 1, date: new Date(Date.UTC(2026, 4, 1 + index * 7)), quantity })),
            { outlet_id: 1, product_id: 2, date: new Date(Date.UTC(2026, 4, 29)), quantity: 999 },
        ]);
    });

    it("aggregates each outlet and summary rounds per outlet", async () => {
        const detail = await SafetyStockService.list({ month: 5, year: 2026, service_level: 80, page: 1, take: 100, order: "asc" });
        expect(detail.data.find((row) => row.product_id === 1 && row.outlet_id === 1)?.safety_stock).toBe(3);
        expect(detail.data.find((row) => row.product_id === 2 && row.outlet_id === 1)?.has_data).toBe(false);
        const summary = await SafetyStockService.summary({ month: 5, year: 2026, service_level: 80, page: 1, take: 100, order: "asc" });
        expect(summary.data.find((row) => row.product_id === 1)).toMatchObject({ total_sales: 90, safety_stock: 6, sales_to_stock_ratio: 15 });
        const issuanceCall = prismaMock.outletIssuance.findMany.mock.calls[0]![0]!;
        expect(issuanceCall.where.date).toEqual({ gte: new Date(Date.UTC(2026, 4, 1)), lt: new Date(Date.UTC(2026, 4, 29)) });
    });

    it("puts discontinue after active before pagination", async () => {
        const result = await SafetyStockService.list({ month: 5, year: 2026, service_level: 80, page: 1, take: 1, sortBy: "safety_stock", order: "desc" });
        expect(result.data[0]!.product_status).toBe("ACTIVE");
    });

    it("uses forecast products as FG universe", async () => {
        prismaMock.forecast.findMany.mockResolvedValueOnce([{ product_id: 1, final_forecast: 0, net_forecast: 0 }]);
        await SafetyStockService.list({ month: 5, year: 2026, service_level: 80, page: 1, take: 100, order: "asc" });
        expect(prismaMock.product.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: [1] } }) }));
    });

    it("orders SKU rows by Forecasting aroma group without merging variants", async () => {
        vi.mocked(orderProductIdsByForecast).mockResolvedValueOnce([2, 1]);
        prismaMock.forecast.findMany.mockResolvedValueOnce([{ product_id: 1, net_forecast: 10, final_forecast: 10 }, { product_id: 2, net_forecast: 100, final_forecast: 100 }]);
        prismaMock.product.findMany.mockResolvedValueOnce([
            { id: 1, code: "HAMPERS-B", name: "HAMPERS ROSE", status: "ACTIVE" },
            { id: 2, code: "A-ROSE", name: "ROSE", status: "ACTIVE" },
        ]);
        const result = await SafetyStockService.list({ month: 5, year: 2026, service_level: 80, page: 1, take: 100, order: "asc" });
        expect([...new Set(result.data.map((row) => row.product_id))]).toEqual([2, 1]);
        expect(new Set(result.data.map((row) => row.product_id)).size).toBe(2);
    });
});
