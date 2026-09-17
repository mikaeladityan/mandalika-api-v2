import { Context } from "hono";
import { ApiResponse } from "../../../../lib/api.response.js";
import {
    QueryDiscontinueMaterialRecommendationSchema,
    RequestBulkSaveDiscontinueMaterialSchema,
} from "./material-recommendation.schema.js";
import { DiscontinueMaterialRecommendationService } from "./material-recommendation.service.js";

export class DiscontinueMaterialRecommendationController {
    static async bulkSave(c: Context) {
        const body = RequestBulkSaveDiscontinueMaterialSchema.parse(await c.req.json());
        const result = await DiscontinueMaterialRecommendationService.bulkSave(body);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async export(c: Context) {
        const query = QueryDiscontinueMaterialRecommendationSchema.parse({
            ...c.req.query(),
            page: 1,
            take: 1_000_000,
        });
        const buffer = await DiscontinueMaterialRecommendationService.export(query);
        c.header("Content-Type", "text/csv");
        c.header("Content-Disposition", `attachment; filename=Rekomendasi_DISCONTINUE_MATERIAL_${query.month}_${query.year}.csv`);
        return c.body(buffer as any);
    }

    static async list(c: Context) {
        const query = QueryDiscontinueMaterialRecommendationSchema.parse(c.req.query());
        const result = await DiscontinueMaterialRecommendationService.list(query);
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
