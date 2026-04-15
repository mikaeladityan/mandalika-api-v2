import { Context } from "hono";
import { StockTotalService } from "./stock-total.service.js";
import { QueryStockTotalSchema } from "./stock-total.schema.js";
import { ApiResponse } from "../../../../../lib/api.response.js";

export class StockTotalController {
    static async list(c: Context) {
        const query  = QueryStockTotalSchema.parse(c.req.query());
        const result = await StockTotalService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async listLocations(c: Context) {
        const result = await StockTotalService.listLocations();
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
