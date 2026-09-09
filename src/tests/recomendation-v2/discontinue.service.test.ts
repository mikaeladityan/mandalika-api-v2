import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../generated/prisma/client.js";
import { calculateDiscontinueNeeds, DiscontinueService } from "../../module/application/recomendation-v2/discontinue/discontinue.service.js";

const db = vi.hoisted(() => ({
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    discontinueNeedAnchor: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock("../../config/prisma.js", () => ({ default: db }));
const decimal = (value: number | string) => new Prisma.Decimal(value);
const recipes = [
    { product_id: 1, material_id: 10, material_name: "Oil", quantity: decimal("0.2") },
    { product_id: 1, material_id: 20, material_name: "Bottle", quantity: decimal(1) },
    { product_id: 1, material_id: 30, material_name: "Box", quantity: decimal(2) },
    { product_id: 2, material_id: 20, material_name: "Bottle", quantity: decimal(4) },
];

describe("Discontinue recipe anchor", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        db.$transaction.mockImplementation((run: (tx: typeof db) => Promise<unknown>) => run(db));
        db.$queryRaw.mockResolvedValue(recipes);
        db.discontinueNeedAnchor.findMany.mockResolvedValue([]);
    });

    it("converts RM input to FG equivalents and scales every recipe while isolating shared RM in other FGs", () => {
        const needs = calculateDiscontinueNeeds(recipes, [{ product_id: 1, anchor_material_id: 10, quantity: decimal(10) }]);
        expect(needs.map((need) => need.total_needed)).toEqual([10, 50, 100, 0]);
        expect(needs[1]?.equivalent_fg).toBe(50);
        expect(needs[3]?.anchor_material_id).toBeNull();
    });

    it("replaces the anchor by another RM without accumulating previous totals", () => {
        const needs = calculateDiscontinueNeeds(recipes, [{ product_id: 1, anchor_material_id: 20, quantity: decimal(30) }]);
        expect(needs.map((need) => need.total_needed)).toEqual([6, 30, 60, 0]);
    });

    it("keeps decimal proportions, handles zero anchors and resets all rows to zero", () => {
        const needs = calculateDiscontinueNeeds(recipes, [{ product_id: 1, anchor_material_id: 10, quantity: decimal("0.3") }]);
        expect(needs[0]?.total_needed).toBe(0.3);
        expect(needs[1]?.total_needed).toBe(1.5);
        expect(calculateDiscontinueNeeds(recipes, [{ product_id: 1, anchor_material_id: 10, quantity: decimal(0) }]).every((need) => need.total_needed === 0)).toBe(true);
        expect(calculateDiscontinueNeeds(recipes, []).every((need) => need.total_needed === 0)).toBe(true);
    });

    it("marks obsolete or zero recipes invalid instead of silently reusing old totals", () => {
        const needs = calculateDiscontinueNeeds(recipes.slice(1), [{ product_id: 1, anchor_material_id: 10, quantity: decimal(100) }]);
        expect(needs[0]?.anchor_valid).toBe(false);
        expect(needs[0]?.total_needed).toBe(0);
    });

    it("saves one anchor per FG and period, returning all affected material totals", async () => {
        db.discontinueNeedAnchor.upsert.mockResolvedValue({ product_id: 1, anchor_material_id: 10, quantity: decimal(10) });
        const result = await DiscontinueService.save({ product_id: 1, month: 9, year: 2026, anchor_material_id: 10, quantity: 10 });
        expect(db.discontinueNeedAnchor.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { product_id_month_year: { product_id: 1, month: 9, year: 2026 } },
            update: { anchor_material_id: 10, quantity: decimal(10) },
        }));
        expect(result.find((row) => row.material_id === 30)?.total_needed).toBe(100);
    });

    it("rejects an anchor from another FG or without positive active recipe", async () => {
        db.$queryRaw.mockResolvedValue(recipes.filter((row) => row.product_id === 1));
        await expect(DiscontinueService.save({ product_id: 1, month: 9, year: 2026, anchor_material_id: 99, quantity: 10 })).rejects.toThrow("recipe aktif");
        expect(db.discontinueNeedAnchor.upsert).not.toHaveBeenCalled();
    });

    it("loads anchors only for the requested FG IDs and period, with size and paper conversions", async () => {
        await DiscontinueService.needs([1], 9, 2026);
        expect(db.discontinueNeedAnchor.findMany).toHaveBeenCalledWith({ where: { product_id: { in: [1] }, month: 9, year: 2026 } });
        const sql = db.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql;
        expect(sql.sql).toContain("r.use_size_calc");
        expect(sql.sql).toContain("rm.barcode IS DISTINCT FROM 'FO-ALK'");
        expect(sql.sql).toContain("5000::numeric / 14000");
        expect(sql.sql).not.toContain("LIMIT");
    });

    it("resets only the selected FG-period, using no regular recommendation draft", async () => {
        await DiscontinueService.reset({ product_id: 1, month: 9, year: 2026 });
        expect(db.discontinueNeedAnchor.deleteMany).toHaveBeenCalledWith({ where: { product_id: 1, month: 9, year: 2026 } });
    });
});
