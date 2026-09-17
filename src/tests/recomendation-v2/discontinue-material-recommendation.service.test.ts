import { afterEach, describe, expect, it, vi } from "vitest";
import { RecomendationV2Service } from "../../module/application/recomendation-v2/recomendation-v2.service.js";
import { DiscontinueMaterialRecommendationService } from "../../module/application/recomendation-v2/discontinue/material-recommendation.service.js";

const baseRow = {
    product_status: "PENDING" as const,
    material_id: 7,
    barcode: "RM-7",
    material_name: "Shared Material",
    ranking: 1,
    moq: 1,
    lead_time: 7,
    uom: "KG",
    current_stock: 20,
    open_po: 10,
    stock_fg_x_resep: 0,
    safety_stock_x_resep: 0,
    forecast_needed: 0,
    total_needed_horizon: 0,
    total_needed_fix_2_months: 0,
    general_recommendation_quantity: 0,
    discontinue_recommendation_quantity: 0,
    recommendation_quantity: 0,
    is_special_paper: false,
    work_order_id: null,
    work_order_status: null,
    work_order_pic_id: null,
    work_order_quantity: null,
    work_order_horizon: null,
    work_order_hidden_at: null,
    sales: [],
    needs: [],
    open_pos: [],
};

describe("DiscontinueMaterialRecommendationService", () => {
    afterEach(() => vi.restoreAllMocks());

    it("aggregates shared RM into one purchase recommendation", async () => {
        vi.spyOn(RecomendationV2Service, "list").mockResolvedValue({
            data: [
                {
                    ...baseRow,
                    row_id: "1_7",
                    finished_goods: [{ id: 1, code: "FG-1", name: "FG One" }],
                    discontinue_anchor: {
                        product_id: 1,
                        material_id: 7,
                        recipe_quantity: 1,
                        total_needed: 50,
                        anchor_material_id: 7,
                        anchor_quantity: 50,
                        anchor_material_name: "Shared Material",
                        equivalent_fg: 50,
                        anchor_valid: true,
                    },
                },
                {
                    ...baseRow,
                    row_id: "2_7",
                    finished_goods: [{ id: 2, code: "FG-2", name: "FG Two" }],
                    discontinue_anchor: {
                        product_id: 2,
                        material_id: 7,
                        recipe_quantity: 2,
                        total_needed: 40,
                        anchor_material_id: 8,
                        anchor_quantity: 20,
                        anchor_material_name: "Anchor RM",
                        equivalent_fg: 20,
                        anchor_valid: true,
                    },
                },
            ],
            len: 2,
            periods: { sales_periods: [], forecast_periods: [], po_periods: [] },
        } as never);

        const result = await DiscontinueMaterialRecommendationService.list({
            page: 1,
            take: 25,
            month: 9,
            year: 2026,
            sales_months: 3,
            forecast_months: 4,
            po_months: 3,
        });

        expect(result.len).toBe(1);
        expect(result.data).toHaveLength(1);
        expect(result.data[0]).toMatchObject({
            row_id: "7",
            material_id: 7,
            recommendation_quantity: 60,
            total_needed_horizon: 90,
        });
        expect(result.data[0]?.finished_goods).toEqual([
            { id: 1, code: "FG-1", name: "FG One" },
            { id: 2, code: "FG-2", name: "FG Two" },
        ]);
        expect(result.data[0]?.discontinue_breakdown).toEqual([
            expect.objectContaining({ product_id: 1, contribution_quantity: 50 }),
            expect.objectContaining({ product_id: 2, contribution_quantity: 40 }),
        ]);
    });

    it("sorts aggregated rows before pagination", async () => {
        vi.spyOn(RecomendationV2Service, "list").mockResolvedValue({
            data: [
                {
                    ...baseRow,
                    row_id: "1_7",
                    finished_goods: [{ id: 1, code: "FG-1", name: "FG One" }],
                    discontinue_anchor: { product_id: 1, material_id: 7, total_needed: 40, anchor_valid: true },
                },
                {
                    ...baseRow,
                    material_id: 8,
                    barcode: "RM-8",
                    material_name: "Other Material",
                    current_stock: 0,
                    open_po: 0,
                    row_id: "2_8",
                    finished_goods: [{ id: 2, code: "FG-2", name: "FG Two" }],
                    discontinue_anchor: { product_id: 2, material_id: 8, total_needed: 100, anchor_valid: true },
                },
            ],
            len: 2,
            periods: { sales_periods: [], forecast_periods: [], po_periods: [] },
        } as never);

        const result = await DiscontinueMaterialRecommendationService.list({
            page: 1, take: 1, month: 9, year: 2026, sales_months: 3, forecast_months: 4, po_months: 3,
            sortBy: "recommendation_quantity", order: "desc",
        });

        expect(result.len).toBe(2);
        expect(result.data.map((row) => row.material_id)).toEqual([8]);
    });

    it("bulk saves aggregate recommendation quantities as PENDING work orders", async () => {
        const list = vi.spyOn(DiscontinueMaterialRecommendationService, "list").mockResolvedValue({
            data: [{ ...baseRow, material_id: 7, recommendation_quantity: 60, total_needed_horizon: 90 } as never],
            len: 1,
            periods: { sales_periods: [], forecast_periods: [], po_periods: [] },
        });
        const saveWorkOrder = vi.spyOn(RecomendationV2Service, "saveWorkOrder").mockResolvedValue({ id: 1 } as never);

        const count = await DiscontinueMaterialRecommendationService.bulkSave({
            month: 9, year: 2026, horizon: 3, type: "ffo",
        });

        expect(list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, take: 1_000_000, type: "ffo" }));
        expect(saveWorkOrder).toHaveBeenCalledWith(expect.objectContaining({
            raw_mat_id: 7,
            product_status: "PENDING",
            quantity: 60,
            total_needed: 90,
        }));
        expect(count).toBe(1);
    });

    it("exports material data without FG columns", async () => {
        vi.spyOn(DiscontinueMaterialRecommendationService, "list").mockResolvedValue({
            data: [{
                ...baseRow,
                finished_goods: [{ id: 1, code: "FG-SECRET", name: "Hidden FG" }],
                recommendation_quantity: 60,
                total_needed_horizon: 90,
            } as never],
            len: 1,
            periods: { sales_periods: [], forecast_periods: [], po_periods: [] },
        });

        const csv = (await DiscontinueMaterialRecommendationService.export({
            page: 1, take: 25, month: 9, year: 2026, sales_months: 3, forecast_months: 4, po_months: 3,
        })).toString("utf8");

        expect(csv).not.toContain("FG Discontinue");
        expect(csv).not.toContain("FG-SECRET");
        expect(csv).toContain("Material");
    });
});
