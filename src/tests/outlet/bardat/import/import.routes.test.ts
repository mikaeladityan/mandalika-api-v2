import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Context } from "hono";
import { OutletRoutes } from "../../../../module/application/outlet/outlet.routes.js";
import { BardatController as BardatCrudController } from "../../../../module/application/outlet/bardat/bardat.controller.js";
import { BardatController } from "../../../../module/application/outlet/bardat/import/import.controller.js";

vi.mock("../../../../module/application/outlet/bardat/import/import.controller.js");
vi.mock("../../../../module/application/outlet/bardat/bardat.controller.js");

const app = new Hono();
app.onError((error, c) => c.json({ error: error.message }, 400));
app.route("/api/app/outlets", OutletRoutes);

describe("BardatRoutes", () => {
    it("rejects execute payload without a valid import id", async () => {
        const response = await app.request("/api/app/outlets/bardat/import/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ import_id: "invalid" }),
        });
        expect(response.status).toBe(400);
    });

    it("routes valid preview id to controller", async () => {
        // reason: The route test deliberately replaces the typed ApiResponse payload with a sentinel.
        vi.mocked(BardatController.getPreview).mockImplementation((async (c: Context) => c.json({ ok: true })) as never);
        const response = await app.request("/api/app/outlets/bardat/import/preview/00000000-0000-4000-8000-000000000001");
        expect(response.status).toBe(200);
        expect((await response.json()).ok).toBe(true);
    });

    it("routes the BARDAT list before the dynamic outlet id", async () => {
        // reason: Replace the typed response with a routing sentinel.
        vi.mocked(BardatCrudController.list).mockImplementation((async (c: Context) => c.json({ bardat: true })) as never);
        const response = await app.request("/api/app/outlets/bardat");
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ bardat: true });
    });
});
