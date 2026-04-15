import { Context } from "hono";
import { StockLocationService } from "./stock-location.service.js";
import { QueryStockLocationSchema } from "./stock-location.schema.js";
import { ApiResponse } from "../../../../../lib/api.response.js";

export class StockLocationController {
    static async list(c: Context) {
        const query  = QueryStockLocationSchema.parse(c.req.query());
        const result = await StockLocationService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async listAvailableLocations(c: Context) {
        const result = await StockLocationService.listAvailableLocations();
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
