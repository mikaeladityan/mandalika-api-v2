import { Context } from "hono";
import { QueryLocationSchema } from "./location.schema.js";
import { LocationService } from "./location.service.js";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";

export class LocationController {
    static async listStockLocation(c: Context) {
        const parsed = QueryLocationSchema.safeParse(c.req.query());
        if (!parsed.success) {
            const message = parsed.error.issues[0]?.message ?? "Parameter query tidak valid";
            throw new ApiError(400, message);
        }

        const result = await LocationService.listStockLocation(parsed.data);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async listLocations(c: Context) {
        const result = await LocationService.listAllLocations();
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
