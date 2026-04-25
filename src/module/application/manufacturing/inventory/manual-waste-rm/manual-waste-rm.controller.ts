import { Context } from "hono";
import { ManualWasteRMService } from "./manual-waste-rm.service.js";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { QueryStockCheckSchema } from "./manual-waste-rm.schema.js";

export class ManualWasteRMController {
    static async list(c: Context) {
        const query = c.req.query();
        const result = await ManualWasteRMService.list(query as any);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async detail(c: Context) {
        const id = Number(c.req.param("id"));
        const result = await ManualWasteRMService.detail(id);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async stockCheck(c: Context) {
        const query = c.req.query();
        const validated = QueryStockCheckSchema.parse(query);
        const result = await ManualWasteRMService.stockCheck(validated.raw_material_id, validated.warehouse_id);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async create(c: Context) {
        const body = await c.req.json();
        const userId = c.get("user")?.id || "system";
        const result = await ManualWasteRMService.create(body, userId);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async returnWaste(c: Context) {
        const id = Number(c.req.param("id"));
        const body = await c.req.json();
        const userId = c.get("user")?.id || "system";
        const result = await ManualWasteRMService.returnWaste(id, body, userId);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async destroy(c: Context) {
        const id = Number(c.req.param("id"));
        const userId = c.get("user")?.id || "system";
        const result = await ManualWasteRMService.destroy(id, userId);
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
