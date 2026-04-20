import { Context } from "hono";
import { RmUsageService } from "./rm-usage.service.js";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { QueryRmUsageSchema } from "./rm-usage.schema.js";

export class RmUsageController {
    static async list(c: Context) {
        const query = QueryRmUsageSchema.parse(c.req.query());
        const result = await RmUsageService.getUsage(query);
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
