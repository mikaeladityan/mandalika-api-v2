import { Context } from "hono";
import { RecomendationV2Service } from "./recomendation-v2.service.js";
import { ApiResponse } from "../../../lib/api.response.js";
import { ApiError } from "../../../lib/errors/api.error.js";
import {
    QueryRecomendationV2DTO,
    RequestApproveWorkOrderSchema,
    RequestSaveWorkOrderSchema,
    RequestBulkSaveHorizonSchema,
    RequestUpdateMoqSchema,
    RequestSaveNeedOverrideSchema,
    RequestDeleteNeedOverrideSchema,
    RequestBulkHideSchema,
    QueryOpenPoCellSchema,
    RequestCreateOpenPoCellSchema,
    RequestUpdateOpenPoCellQtySchema,
} from "./recomendation-v2.schema.js";

export class RecomendationV2Controller {
    static async list(c: Context) {
        const { page, take, search, month, year, type, sales_months, forecast_months, po_months, sortBy, order } = c.req.query();

        const params: QueryRecomendationV2DTO = {
            page: page ? Number(page) : 1,
            take: take ? Number(take) : 25,
            search,
            month: month ? Number(month) : undefined,
            year: year ? Number(year) : undefined,
            type: type as QueryRecomendationV2DTO["type"],
            sales_months: sales_months ? Number(sales_months) : 3,
            forecast_months: forecast_months ? Number(forecast_months) : 3,
            po_months: po_months ? Number(po_months) : 3,
            sortBy: sortBy as QueryRecomendationV2DTO["sortBy"],
            order: order as QueryRecomendationV2DTO["order"],
        };

        const result = await RecomendationV2Service.list(params);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async bulkToggleHide(c: Context) {
        const body = await c.req.json();
        const validBody = RequestBulkHideSchema.parse(body);
        const result = await RecomendationV2Service.bulkToggleHide(validBody);
        return ApiResponse.sendSuccess(c, result, 200);
    }
    
    static async export(c: Context) {
        const { search, month, year, type, sales_months, forecast_months, po_months, sortBy, order, visibleColumns, columnOrder, selectedIds } = c.req.query();

        const params: QueryRecomendationV2DTO = {
            page: 1,
            take: 1000000,
            search,
            month: month ? Number(month) : undefined,
            year: year ? Number(year) : undefined,
            type: type as QueryRecomendationV2DTO["type"],
            sales_months: sales_months ? Number(sales_months) : 3,
            forecast_months: forecast_months ? Number(forecast_months) : 3,
            po_months: po_months ? Number(po_months) : 3,
            sortBy: sortBy as QueryRecomendationV2DTO["sortBy"],
            order: order as QueryRecomendationV2DTO["order"],
            visibleColumns,
            columnOrder,
            selectedIds,
        };

        const buffer = await RecomendationV2Service.export(params);

        c.header("Content-Type", "text/csv");
        c.header("Content-Disposition", `attachment; filename=Rekomendasi_V2_${type?.toUpperCase()}_${month}_${year}.csv`);

        return c.body(buffer as any);
    }

    static async saveWorkOrder(c: Context) {
        const body = await c.req.json();
        const validBody = RequestSaveWorkOrderSchema.parse(body);
        const result = await RecomendationV2Service.saveWorkOrder(validBody);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async approveWorkOrder(c: Context) {
        const body = await c.req.json();
        const validBody = RequestApproveWorkOrderSchema.parse(body);
        const userId = c.get("userId") || "anonymous";
        const result = await RecomendationV2Service.approveWorkOrder(validBody, userId);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async destroyWorkOrder(c: Context) {
        const id = Number(c.req.param("id"));
        const result = await RecomendationV2Service.destroyWorkOrder(id);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async bulkSaveHorizon(c: Context) {
        const body = await c.req.json();
        const validBody = RequestBulkSaveHorizonSchema.parse(body);
        const result = await RecomendationV2Service.bulkSaveHorizon(validBody);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async updateMoq(c: Context) {
        const body = await c.req.json();
        const validBody = RequestUpdateMoqSchema.parse(body);
        const result = await RecomendationV2Service.updateMoq(validBody);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async saveNeedOverride(c: Context) {
        const body = await c.req.json();
        const validBody = RequestSaveNeedOverrideSchema.parse(body);
        const result = await RecomendationV2Service.saveNeedOverride(validBody);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async deleteNeedOverride(c: Context) {
        const body = await c.req.json();
        const validBody = RequestDeleteNeedOverrideSchema.parse(body);
        const result = await RecomendationV2Service.deleteNeedOverride(validBody);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async listOpenPoCell(c: Context) {
        const query = QueryOpenPoCellSchema.parse(c.req.query());
        const result = await RecomendationV2Service.listOpenPoCell(query);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async createOpenPoCell(c: Context) {
        const body = await c.req.json();
        const validBody = RequestCreateOpenPoCellSchema.parse(body);
        const userId = c.get("user")?.id || "system";
        const result = await RecomendationV2Service.createOpenPoCell(validBody, userId);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async updateOpenPoCellQty(c: Context) {
        const id = Number(c.req.param("itemId"));
        const body = await c.req.json();
        const validBody = RequestUpdateOpenPoCellQtySchema.parse(body);
        const result = await RecomendationV2Service.updateOpenPoCellQty(id, validBody);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async deleteOpenPoCellItem(c: Context) {
        const id = Number(c.req.param("itemId"));
        const result = await RecomendationV2Service.deleteOpenPoCellItem(id);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async listSuppliersForMaterial(c: Context) {
        const rawMatId = Number(c.req.query("raw_mat_id"));
        if (!rawMatId || Number.isNaN(rawMatId)) {
            throw new ApiError(400, "raw_mat_id required");
        }
        const result = await RecomendationV2Service.listSuppliersForMaterial(rawMatId);
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
