import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { IssuanceController } from "../../module/application/issuance/issuance.controller.js";
import { IssuanceService } from "../../module/application/issuance/issuance.service.js";

vi.mock("../../module/application/issuance/issuance.service.js", () => ({
    IssuanceService: { list: vi.fn(), export: vi.fn() },
}));

describe("Hampers analytics HTTP parameters", () => {
    const app = new Hono();
    app.get("/", IssuanceController.list);
    app.get("/export", IssuanceController.export);
    beforeEach(() => vi.clearAllMocks());

    it("passes Hampers scope and returns the unpaginated summary", async () => {
        const result = { issuances: [], len: 0, hampersSummary: [{ year: 2026, month: 3, quantity: 200, previousQuantity: 100, difference: 100, percentage: 100, trend: "UP" as const }] };
        vi.mocked(IssuanceService.list).mockResolvedValue(result);
        const response = await app.request("/?hampers_only=true&sales_analytics=true&page=2");
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ data: result });
        expect(IssuanceService.list).toHaveBeenCalledWith(expect.objectContaining({ hampers_only: true, sales_analytics: true, page: 2 }));
    });

    it("does not enable the scope for a false query value", async () => {
        vi.mocked(IssuanceService.list).mockResolvedValue({ issuances: [], len: 0 });
        await app.request("/?hampers_only=false");
        expect(IssuanceService.list).toHaveBeenCalledWith(expect.objectContaining({ hampers_only: false }));
    });

    it("preserves the Hampers scope in CSV export", async () => {
        vi.mocked(IssuanceService.export).mockResolvedValue(new ArrayBuffer(0));
        const response = await app.request("/export?hampers_only=true&sales_analytics=true");
        expect(response.status).toBe(200);
        expect(IssuanceService.export).toHaveBeenCalledWith(expect.objectContaining({ hampers_only: true, sales_analytics: true, page: 1 }));
    });
});
