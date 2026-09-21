import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ApiError } from "../../lib/errors/api.error.js";

const lockService = vi.hoisted(() => ({
    createLock: vi.fn().mockResolvedValue({ version: 1, counts: { total: 0 } }),
    releaseLock: vi.fn().mockResolvedValue({ status: "RELEASED" }),
    listLocks: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../module/application/recomendation-v2/period-lock/services.js", () => ({
    RecommendationPeriodLockService: lockService,
}));

import routes from "../../module/application/recomendation-v2/period-lock/routes.js";

const app = new Hono();
app.onError((error, c) => c.json({ error: error.message, details: (error as ApiError).details }, error instanceof ApiError ? error.statusCode : 500));
app.route("/recommendations", routes);

describe("Recommendation period lock routes", () => {
    it("validates period with Indonesian messages", async () => {
        const response = await app.request("/recommendations/lock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month: 13, year: 2026 }),
        });
        expect(response.status).toBe(400);
        expect(await response.text()).toContain("Bulan maksimal 12");
    });

    it("passes actor and period to lock service", async () => {
        const response = await app.request("/recommendations/lock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month: 9, year: 2026, note: "Tutup periode" }),
        });
        expect(response.status).toBe(200);
        expect(lockService.createLock).toHaveBeenCalledWith({ month: 9, year: 2026, note: "Tutup periode" }, "anonymous");
    });

    it("lists lock history using query period", async () => {
        const response = await app.request("/recommendations/locks?month=9&year=2026");
        expect(response.status).toBe(200);
        expect(lockService.listLocks).toHaveBeenCalledWith({ month: 9, year: 2026 });
    });
});
