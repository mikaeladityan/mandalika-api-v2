import type { Context } from "hono";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ForecastAccuracyService } from "./accuracy.service.js";
import { QueryForecastAccuracySchema, QueryForecastAccuracyTrendSchema, QueryEdarVsActSchema } from "./accuracy.schema.js";

export class ForecastAccuracyController {
    static async list(c: Context) {
        const params = QueryForecastAccuracySchema.parse(c.req.query());
        const result = await ForecastAccuracyService.list(params);
        return ApiResponse.sendSuccess(c, result, 200, params);
    }

    static async trend(c: Context) {
        const params = QueryForecastAccuracyTrendSchema.parse(c.req.query());
        const result = await ForecastAccuracyService.trend(params);
        return ApiResponse.sendSuccess(c, result, 200, params);
    }

    static async edarVsAct(c: Context) {
        const params = QueryEdarVsActSchema.parse(c.req.query());
        const result = await ForecastAccuracyService.edarVsAct(params);
        return ApiResponse.sendSuccess(c, result, 200, params);
    }
}
