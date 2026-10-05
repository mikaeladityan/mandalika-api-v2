import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Prisma } from "../../generated/prisma/client.js";
import { calculateDiscontinueLoss, DiscontinueLossService } from "../../module/application/recomendation-v2/discontinue/discontinue-loss.service.js";
import routes from "../../module/application/recomendation-v2/discontinue/discontinue.routes.js";
import prisma from "../../config/prisma.js";
import { RecommendationPeriodLockService } from "../../module/application/recomendation-v2/period-lock/services.js";
import { DiscontinueService } from "../../module/application/recomendation-v2/discontinue/discontinue.service.js";

const material = (stock: number, price: number | null, openPo = 0) => ({
    material_id: 1, barcode: "RM-1", material_name: "Bottle", uom: "PCS",
    stock: new Prisma.Decimal(stock), open_po: new Prisma.Decimal(openPo), unit_price: price === null ? null : new Prisma.Decimal(price),
});
const need = (quantity: number) => ({
    product_id: 1, material_id: 1, recipe_quantity: 1, total_needed: quantity,
    anchor_material_id: 1, anchor_quantity: quantity, anchor_material_name: "Bottle",
    equivalent_fg: quantity, anchor_valid: true,
});

describe("Discontinue loss check", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.recommendationPeriodLock.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.rawMaterialInventory.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.productInventory.findFirst).mockResolvedValue(null);
    });
    afterEach(() => vi.restoreAllMocks());

    it("deducts outstanding PO from new purchases without adding it to physical remaining stock", () => {
        const result = calculateDiscontinueLoss([material(100, 1500, 15)], [need(120)]);
        expect(result.rows[0]).toMatchObject({ total_needed: 120, open_po: 15, need_buy: 5, purchase_value: 7500, remaining: 0 });
        const surplus = calculateDiscontinueLoss([material(200, 1500, 50)], [need(120)]);
        expect(surplus.rows[0]).toMatchObject({ need_buy: 0, remaining: 80, remaining_value: 120000 });
        expect(calculateDiscontinueLoss([material(100, 1500, 50)], [need(120)]).purchase_value).toBe(0);
    });

    it("keeps decimal quantities and monetary rounding when PO covers part of a shortage", () => {
        expect(calculateDiscontinueLoss([material(0.1, 2.55, 0.2)], [need(0.4)]).rows[0])
            .toMatchObject({ need_buy: 0.1, purchase_value: 0.26, remaining: 0 });
    });

    it("uses the table's latest inventory periods and both outstanding PO sources", async () => {
        vi.spyOn(DiscontinueService, "needs").mockResolvedValue([need(120)]);
        vi.mocked(prisma.rawMaterialInventory.findFirst).mockResolvedValue({ month: 9, year: 2026 } as never);
        vi.mocked(prisma.productInventory.findFirst).mockResolvedValue({ month: 8, year: 2026 } as never);
        vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([material(100, 1500, 15)]);
        const result = await DiscontinueLossService.check({ product_id: 1, material_id: 1, month: 10, year: 2026 });
        expect(result.purchase_value).toBe(7500);
        const query = vi.mocked(prisma.$queryRaw).mock.calls[0]![0] as Prisma.Sql;
        expect(query.values).toEqual(expect.arrayContaining([9, 8]));
        expect(query.values).not.toContain(10);
        expect(query.sql).toContain("raw_material_open_pos");
        expect(query.sql).toContain("qty_ordered - poi.qty_received");
    });

    it("retains the selected historical period even when newer inventory exists", async () => {
        vi.spyOn(DiscontinueService, "needs").mockResolvedValue([need(120)]);
        vi.mocked(prisma.rawMaterialInventory.findFirst).mockResolvedValue({ month: 10, year: 2026 } as never);
        vi.mocked(prisma.productInventory.findFirst).mockResolvedValue({ month: 10, year: 2026 } as never);
        vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([material(100, 1500)]);
        await DiscontinueLossService.check({ product_id: 1, month: 8, year: 2026 });
        const query = vi.mocked(prisma.$queryRaw).mock.calls[0]![0] as Prisma.Sql;
        expect(query.values).toContain(8);
        expect(query.values).not.toContain(10);
    });

    it("reads stored valuations and selected RM from locked snapshots without consulting live data", async () => {
        const stored = calculateDiscontinueLoss([material(100, 1500, 15)], [need(120)]);
        vi.spyOn(RecommendationPeriodLockService, "findLockedRows").mockResolvedValue({ rows: [
            { fg_id: 1, raw_mat_id: 1, payload: { discontinue_loss: stored } },
            { fg_id: 1, raw_mat_id: 2, payload: {} },
            { fg_id: 2, raw_mat_id: 1, payload: {} },
        ] } as never);
        const needs = vi.spyOn(DiscontinueService, "needs");
        expect(await DiscontinueLossService.check({ product_id: 1, material_id: 1, month: 9, year: 2026 }))
            .toMatchObject({ locked: true, historical_prices_missing: false, rows: stored.rows, purchase_value: 7500 });
        expect(needs).not.toHaveBeenCalled();
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("combines all recipe RM valuations from the locked FG", async () => {
        const first = calculateDiscontinueLoss([material(100, 1500, 15)], [need(120)]);
        const second = calculateDiscontinueLoss([{ ...material(200, 10), material_id: 2 }], [{ ...need(120), material_id: 2 }]);
        vi.spyOn(RecommendationPeriodLockService, "findLockedRows").mockResolvedValue({ rows: [
            { fg_id: 1, raw_mat_id: 1, payload: { discontinue_loss: first } },
            { fg_id: 1, raw_mat_id: 2, payload: { discontinue_loss: second } },
        ] } as never);
        const result = await DiscontinueLossService.check({ product_id: 1, month: 9, year: 2026 });
        expect(result.rows).toHaveLength(2);
        expect(result).toMatchObject({ locked: true, remaining_value: 800, purchase_value: 7500 });
    });

    it("uses historical quantities with unavailable prices for legacy locks", async () => {
        vi.spyOn(RecommendationPeriodLockService, "findLockedRows").mockResolvedValue({ rows: [{
            fg_id: 1, raw_mat_id: 1, payload: {
                material_id: 1, barcode: "RM-1", material_name: "Bottle", uom: "PCS",
                current_stock: 100, open_po: 15, discontinue_anchor: need(120),
            },
        }] } as never);
        const result = await DiscontinueLossService.check({ product_id: 1, month: 9, year: 2026 });
        expect(result).toMatchObject({ locked: true, historical_prices_missing: true, missing_prices: 1 });
        expect(result.rows[0]).toMatchObject({ need_buy: 5, purchase_value: null, remaining_value: null });
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("rejects absent snapshot rows rather than falling back to live calculations", async () => {
        vi.spyOn(RecommendationPeriodLockService, "findLockedRows").mockResolvedValue({ rows: [] } as never);
        await expect(DiscontinueLossService.check({ product_id: 1, month: 9, year: 2026 }))
            .rejects.toMatchObject({ statusCode: 404 });
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
    it("checks only the selected RM and rejects an RM outside the FG recipe", async () => {
        const needs = vi.spyOn(DiscontinueService, "needs").mockResolvedValue([
            need(120), { ...need(500), material_id: 2 },
        ]);
        vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([material(100, 1500)]);
        try {
            const result = await DiscontinueLossService.check({ product_id: 1, material_id: 1, month: 9, year: 2026 });
            expect(result.rows).toHaveLength(1);
            expect(result.rows[0]).toMatchObject({ material_id: 1, need_buy: 20, remaining_value: 0 });
            await expect(DiscontinueLossService.check({ product_id: 1, material_id: 99, month: 9, year: 2026 })).rejects.toThrow("RM tidak memiliki recipe aktif");
        } finally {
            needs.mockRestore();
        }
    });
    it("covers every RM in the FG recipe when no material is selected", async () => {
        const needs = vi.spyOn(DiscontinueService, "needs").mockResolvedValue([
            need(120), { ...need(500), material_id: 2 },
        ]);
        vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
            material(100, 1500), { ...material(400, 10), material_id: 2, material_name: "Cap" },
        ]);
        try {
            const result = await DiscontinueLossService.check({ product_id: 1, month: 9, year: 2026 });
            expect(result.rows).toHaveLength(2);
            expect(result.rows.map((row) => row.material_id)).toEqual([1, 2]);
        } finally {
            needs.mockRestore();
        }
    });
    it("serves the check when the client omits material_id", async () => {
        const check = vi.spyOn(DiscontinueLossService, "check")
            .mockResolvedValue(calculateDiscontinueLoss([material(100, 1500)], [need(120)]));
        try {
            const app = new Hono().route("/discontinue", routes);
            const response = await app.request("/discontinue/loss?product_id=1&month=9&year=2026");
            expect(response.status).toBe(200);
            expect(check).toHaveBeenCalledWith({ product_id: 1, month: 9, year: 2026 });
        } finally {
            check.mockRestore();
        }
    });
    it("uses the same deterministic preferred supplier ordering as recommendations", async () => {
        const needs = vi.spyOn(DiscontinueService, "needs").mockResolvedValue([need(120)]);
        vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([material(100, 1500)]);
        try {
            await DiscontinueLossService.check({ product_id: 1, material_id: 1, month: 9, year: 2026 });
            const call = vi.mocked(prisma.$queryRaw).mock.calls[0];
            expect(call).toBeDefined();
            const sql = (call![0] as { sql: string }).sql;
            expect(sql).toContain("ORDER BY sm.supplier_id ASC LIMIT 1");
            expect(sql).not.toContain("ORDER BY sm.updated_at DESC, sm.id DESC");
        } finally {
            needs.mockRestore();
        }
    });
    it("values stock after the full need and separately values purchases", () => {
        const result = calculateDiscontinueLoss([material(100, 1500)], [need(120)]);
        expect(result.rows[0]).toMatchObject({ stock: 100, need_buy: 20, remaining: 0, remaining_value: 0, purchase_value: 30000 });
        expect(result.remaining_value).toBe(0);
        expect(result.purchase_value).toBe(30000);
        expect(result.rows[0]).not.toHaveProperty("unit_price");
    });
    it("keeps stock above the full need as remaining stock", () => {
        const result = calculateDiscontinueLoss([material(200, 1500)], [need(120)]);
        expect(result.rows[0]).toMatchObject({ stock: 200, need_buy: 0, remaining: 80, remaining_value: 120000, purchase_value: 0 });
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
            const response = await app.request("/discontinue/loss?product_id=1&material_id=1&month=9&year=2026");
            expect(response.status).toBe(200);
            expect(check).toHaveBeenCalledWith({ product_id: 1, material_id: 1, month: 9, year: 2026 });
            expect(await response.text()).not.toContain("unit_price");
        } finally {
            check.mockRestore();
        }
    });
});
