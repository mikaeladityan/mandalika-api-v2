import type { Context } from "hono";
import { ApiResponse } from "../../../../lib/api.response.js";
import { QuerySafetyStockSchema, QuerySafetyStockSummarySchema } from "./schema.js";
import { SafetyStockService } from "./services.js";

export class SafetyStockController {
    static async list(c: Context) {
        const query = QuerySafetyStockSchema.parse(c.req.query());
        return ApiResponse.sendSuccess(c, await SafetyStockService.list(query), 200, query);
    }

    static async summary(c: Context) {
        const query = QuerySafetyStockSummarySchema.parse(c.req.query());
        return ApiResponse.sendSuccess(c, await SafetyStockService.summary(query), 200, query);
    }
}
