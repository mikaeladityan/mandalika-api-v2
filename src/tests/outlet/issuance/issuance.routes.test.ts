import { describe, expect, it, vi } from "vitest";
import { Context, Hono } from "hono";
import { OutletRoutes } from "../../../module/application/outlet/outlet.routes.js";
import { IssuanceController } from "../../../module/application/outlet/issuance/issuance.controller.js";

vi.mock("../../../module/application/outlet/issuance/issuance.controller.js");

const app = new Hono();
app.onError((error, c) => c.json({ error: error.message }, 400));
app.route("/api/app/outlets", OutletRoutes);

describe("Outlet Issuance routes", () => {
    it("routes list and does not expose delete", async () => {
        vi.mocked(IssuanceController.list).mockImplementation((async (c: Context) => c.json({ issuance: true })) as never);
        const response = await app.request("/api/app/outlets/issuance");
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ issuance: true });
        const deleteResponse = await app.request("/api/app/outlets/issuance/1", { method: "DELETE" });
        expect(deleteResponse.status).toBe(404);
    });
});
