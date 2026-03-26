import { Context } from "hono";
import {
    QueryRecomendationSchema,
    RequestAccRecommendationSchema,
} from "./recomendation.schema.js";
import { RecomendationService } from "./recomendation.service.js";
import { ApiResponse } from "../../../lib/api.response.js";

export class RecomendationController {
    static async list(c: Context) {
        const query = c.req.query();
        const validQuery = QueryRecomendationSchema.parse(query);
        const result = await RecomendationService.list(validQuery);
        return ApiResponse.sendSuccess(c, result);
    }

    static async saveOrderQuantity(c: Context) {
        const body = await c.req.json();
        const result = await RecomendationService.saveOrderQuantity(body);
        return ApiResponse.sendSuccess(c, result);
    }

    static async approve(c: Context) {
        const bodyStr = await c.req.json();
        const body = RequestAccRecommendationSchema.parse(bodyStr);
        // Pass userId if available from context (authMiddleware sets it), otherwise default to null/anonymous
        const userId = c.get("userId") || "anonymous";

        const result = await RecomendationService.approveRecommendation(body, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async destroy(c: Context) {
        const id = Number(c.req.param("id"));
        const result = await RecomendationService.destroy(id);
        return ApiResponse.sendSuccess(c, result);
    }
}
