import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Prisma } from "../../generated/prisma/client.js";
import { calculateDiscontinueLoss, DiscontinueLossService } from "../../module/application/recomendation-v2/discontinue/discontinue-loss.service.js";
import routes from "../../module/application/recomendation-v2/discontinue/discontinue.routes.js";

const material = (stock: number, price: number | null) => ({
    material_id: 1, barcode: "RM-1", material_name: "Bottle", uom: "PCS",
    stock: new Prisma.Decimal(stock), unit_price: price === null ? null : new Prisma.Decimal(price),
});
const need = (quantity: number) => ({
    product_id: 1, material_id: 1, recipe_quantity: 1, total_needed: quantity,
    anchor_material_id: 1, anchor_quantity: quantity, anchor_material_name: "Bottle",
    equivalent_fg: quantity, anchor_valid: true,
});

describe("Discontinue loss check", () => {
    it("values stock minus the purchase recommendation and separately values purchases", () => {
        const result = calculateDiscontinueLoss([material(100, 1500)], [need(120)]);
        expect(result.rows[0]).toMatchObject({ stock: 100, need_buy: 20, remaining: 80, remaining_value: 120000, purchase_value: 30000 });
        expect(result.remaining_value).toBe(120000);
        expect(result.purchase_value).toBe(30000);
        expect(result.rows[0]).not.toHaveProperty("unit_price");
    });
    it("clamps negative remaining stock and retains decimal money precision", () => {
        const result = calculateDiscontinueLoss([material(0.1, 2.55)], [need(0.4)]);
        expect(result.rows[0]).toMatchObject({ need_buy: 0.3, remaining: 0, remaining_value: 0, purchase_value: 0.77 });
    });
    it("marks missing prices and absent anchors instead of inventing a price", () => {
        const result = calculateDiscontinueLoss([material(100, null)], []);
        expect(result.rows[0]).toMatchObject({ need_buy: 0, remaining_value: null, purchase_value: null });
        expect(result.missing_prices).toBe(1);
        expect(result.anchor_valid).toBe(false);
    });
    it("serves the check for a validated FG and period", async () => {
        const result = calculateDiscontinueLoss([material(100, 1500)], [need(120)]);
        const check = vi.spyOn(DiscontinueLossService, "check").mockResolvedValue(result);
        try {
            const app = new Hono().route("/discontinue", routes);
            const response = await app.request("/discontinue/loss?product_id=1&month=9&year=2026");
            expect(response.status).toBe(200);
            expect(check).toHaveBeenCalledWith({ product_id: 1, month: 9, year: 2026 });
            expect(await response.text()).not.toContain("unit_price");
        } finally {
            check.mockRestore();
        }
    });
});
