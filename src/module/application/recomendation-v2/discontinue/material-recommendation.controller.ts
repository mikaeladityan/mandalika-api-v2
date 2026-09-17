import { Context } from "hono";
import { ApiResponse } from "../../../../lib/api.response.js";
import { QueryDiscontinueMaterialRecommendationSchema } from "./material-recommendation.schema.js";
import { DiscontinueMaterialRecommendationService } from "./material-recommendation.service.js";

export class DiscontinueMaterialRecommendationController {
    static async list(c: Context) {
        const query = QueryDiscontinueMaterialRecommendationSchema.parse(c.req.query());
        const result = await DiscontinueMaterialRecommendationService.list(query);
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
