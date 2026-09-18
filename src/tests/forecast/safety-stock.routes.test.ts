import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

const serviceMock = vi.hoisted(() => ({
    list: vi.fn().mockResolvedValue({ data: [], len: 0, page: 1, take: 50, period_start: "2026-05-01", period_end: "2026-05-28", service_level: 80, z_value: 0.8416212335729143 }),
    summary: vi.fn().mockResolvedValue({ data: [], len: 0, page: 1, take: 50, period_start: "2026-05-01", period_end: "2026-05-28", service_level: 80, z_value: 0.8416212335729143 }),
}));
vi.mock("../../module/application/forecast/safety-stock/services.js", () => ({ SafetyStockService: serviceMock }));

import { SafetyStockRoutes } from "../../module/application/forecast/safety-stock/routes.js";

describe("SafetyStockRoutes", () => {
    it("validates detail and summary queries", async () => {
        const app = new Hono();
        app.onError((error, c) => c.json({ status: "error" }, ((error as { statusCode?: number }).statusCode ?? 500) as 400));
        app.route("/safety-stock", SafetyStockRoutes);
        const detail = await app.request("/safety-stock?month=5&year=2026&service_level=95");
        expect(detail.status).toBe(200);
        expect(serviceMock.list).toHaveBeenCalledWith(expect.objectContaining({ month: 5, year: 2026, service_level: 95 }));
        const summary = await app.request("/safety-stock/summary?month=5&year=2026");
        expect(summary.status).toBe(200);
        expect(serviceMock.summary).toHaveBeenCalledWith(expect.objectContaining({ service_level: 80 }));
        const invalid = await app.request("/safety-stock?month=13&year=2026");
        expect(invalid.status).toBe(400);
    });

    it("returns actionable response when database is unavailable", async () => {
        serviceMock.list.mockRejectedValueOnce(Object.assign(new Error("database unavailable"), { code: "P1001" }));
        const app = new Hono();
        app.onError((error, c) => c.json({ status: "error", message: error.message }, ((error as { statusCode?: number }).statusCode ?? 500) as 400));
        app.route("/safety-stock", SafetyStockRoutes);

        const response = await app.request("/safety-stock?month=5&year=2026");
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({ message: "Database belum dapat dihubungi. Periksa koneksi database lalu coba lagi." });
    });
});
