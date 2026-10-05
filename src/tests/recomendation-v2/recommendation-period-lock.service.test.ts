import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecomendationV2Service } from "../../module/application/recomendation-v2/recomendation-v2.service.js";
import { Prisma } from "../../generated/prisma/client.js";
import prisma from "../../config/prisma.js";
import { RecommendationLockStatus, RecommendationLockView, RecommendationPeriodLockService } from "../../module/application/recomendation-v2/period-lock/services.js";

const activeLock = {
    id: 7,
    month: 9,
    year: 2026,
    version: 3,
    status: RecommendationLockStatus.LOCKED,
    locked_at: new Date("2026-09-19T00:20:00.000Z"),
    locked_by: "user-1",
    note: "Tutup periode",
    meta: { periods: { sales_periods: [], forecast_periods: [], po_periods: [] } },
    _count: { rows: 1 },
};

describe("RecommendationPeriodLockService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.recommendationPeriodLock.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.recommendationLockRow.findMany).mockResolvedValue([]);
        vi.mocked(prisma.recommendationLockRow.count).mockResolvedValue(0);
    });

    afterEach(() => vi.restoreAllMocks());

    it("captures discontinued FG quantities and valuation in the same snapshot payload", async () => {
        const periods = { sales_periods: [], forecast_periods: [], po_periods: [] };
        vi.spyOn(RecomendationV2Service, "list").mockResolvedValueOnce({ data: [], len: 0, periods })
            .mockResolvedValueOnce({ data: [{
                material_id: 1, material_name: "Bottle", barcode: "RM-1", uom: "PCS",
                current_stock: 100, open_po: 15, sales: [], needs: [], open_pos: [],
                finished_goods: [{ id: 1, code: "FG-1", name: "FG One" }],
                discontinue_anchor: {
                    product_id: 1, material_id: 1, recipe_quantity: 1, total_needed: 120,
                    anchor_material_id: 1, anchor_quantity: 120, anchor_material_name: "Bottle",
                    equivalent_fg: 120, anchor_valid: true,
                },
            }], len: 1, periods });
        vi.spyOn(prisma.rawMaterial, "findMany").mockResolvedValueOnce([{
            id: 1, supplier_materials: [{ unit_price: new Prisma.Decimal(1500), supplier_id: 1, supplier: { name: "Supplier" } }],
        }] as never);
        const create = vi.fn().mockResolvedValue(activeLock);
        vi.spyOn(prisma, "$transaction").mockImplementationOnce((async (callback: (tx: unknown) => Promise<unknown>) => callback({
            recommendationPeriodLock: { findFirst: vi.fn().mockResolvedValue(null), create },
        })) as never);
        await RecommendationPeriodLockService.createLock({ month: 9, year: 2026 }, "user-1");
        const rows = create.mock.calls[0]![0].data.rows.create;
        const fg = rows.find((row: { view: string }) => row.view === RecommendationLockView.DISCONTINUE_FG);
        expect(fg.payload.discontinue_loss).toMatchObject({
            purchase_value: 7500, anchor_valid: true,
            rows: [{ total_needed: 120, stock: 100, open_po: 15, need_buy: 5, purchase_value: 7500 }],
        });
        expect(fg.payload.discontinue_loss.rows[0]).not.toHaveProperty("unit_price");
    });

    it("rejects writes for active period lock with machine-readable code", async () => {
        vi.mocked(prisma.recommendationPeriodLock.findFirst).mockResolvedValue(activeLock as never);
        await expect(RecommendationPeriodLockService.assertPeriodUnlocked(9, 2026))
            .rejects.toMatchObject({ statusCode: 409, name: "PERIOD_LOCKED", details: { code: "PERIOD_LOCKED" } });
    });

    it("reads snapshot rows with lock metadata", async () => {
        vi.mocked(prisma.recommendationPeriodLock.findFirst).mockResolvedValue(activeLock as never);
        vi.mocked(prisma.recommendationLockRow.findMany).mockResolvedValue([{
            id: 1,
            lock_id: 7,
            view: RecommendationLockView.DISCONTINUE_MATERIAL,
            raw_mat_id: 10,
            fg_id: null,
            fg_id_key: 0,
            product_status: "PENDING",
            material_name: "RM X",
            barcode: "RM-X",
            category_name: null,
            supplier_id: 2,
            supplier_name: "Supplier",
            type_tag: "lokal",
            sort_sales: 12,
            sort_current_stock: 3,
            sort_forecast_needed: 0,
            sort_recommendation: 9,
            hidden: false,
            payload: { material_id: 10, material_name: "RM X", recommendation_quantity: 9 },
        }] as never);
        vi.mocked(prisma.recommendationLockRow.count).mockResolvedValue(1);

        const result = await RecommendationPeriodLockService.listLockedRows({
            month: 9, year: 2026, page: 1, take: 25, type: "lokal", sortBy: "recommendation_quantity", order: "desc",
        }, RecommendationLockView.DISCONTINUE_MATERIAL);

        expect(result).toMatchObject({
            len: 1,
            lock: { locked: true, version: 3 },
            data: [{ material_id: 10, recommendation_quantity: 9, work_order_hidden_at: null }],
        });
        expect(vi.mocked(prisma.recommendationLockRow.findMany)).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ view: RecommendationLockView.DISCONTINUE_MATERIAL, type_tag: "lokal" }),
            orderBy: [{ sort_recommendation: "desc" }, { id: "asc" }],
        }));
    });
});
