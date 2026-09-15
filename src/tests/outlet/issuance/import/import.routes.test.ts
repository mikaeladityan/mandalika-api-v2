import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Context } from "hono";
import { OutletRoutes } from "../../../../module/application/outlet/outlet.routes.js";
import { IssuanceController } from "../../../../module/application/outlet/issuance/import/import.controller.js";

vi.mock("../../../../module/application/outlet/issuance/import/import.controller.js");

const app = new Hono();
app.onError((error, c) => c.json({ error: error.message }, 400));
app.route("/api/app/outlets", OutletRoutes);

describe("IssuanceRoutes", () => {
    it("rejects execute payload without a valid import id", async () => {
        const response = await app.request("/api/app/outlets/issuance/import/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ import_id: "invalid" }),
        });
        expect(response.status).toBe(400);
    });

    it("routes valid preview id to controller", async () => {
        // reason: The route test deliberately replaces the typed ApiResponse payload with a sentinel.
        vi.mocked(IssuanceController.getPreview).mockImplementation((async (c: Context) => c.json({ ok: true })) as never);
        const response = await app.request("/api/app/outlets/issuance/import/preview/00000000-0000-4000-8000-000000000001");
        expect(response.status).toBe(200);
        expect((await response.json()).ok).toBe(true);
    });
});
