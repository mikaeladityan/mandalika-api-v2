import type { Context } from "hono";
import { ApiResponse } from "../../../../lib/api.response.js";
import { QueryStockResilienceSchema } from "./stock-resilience.schema.js";
import { StockResilienceService } from "./stock-resilience.service.js";

export class StockResilienceController {
    static async list(c: Context) {
        const query = QueryStockResilienceSchema.parse(c.req.query());
        return ApiResponse.sendSuccess(c, await StockResilienceService.list(query), 200, query);
    }
}

