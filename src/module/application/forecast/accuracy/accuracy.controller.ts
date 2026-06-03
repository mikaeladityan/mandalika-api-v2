import type { Context } from "hono";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ForecastAccuracyService } from "./accuracy.service.js";
import { QueryForecastAccuracySchema } from "./accuracy.schema.js";

export class ForecastAccuracyController {
    static async list(c: Context) {
        const params = QueryForecastAccuracySchema.parse(c.req.query());
        const result = await ForecastAccuracyService.list(params);
        return ApiResponse.sendSuccess(c, result, 200, params);
    }
}
