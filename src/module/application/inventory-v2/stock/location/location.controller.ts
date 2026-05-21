import { Context } from "hono";
import { QueryLocationSchema } from "./location.schema.js";
import { LocationService } from "./location.service.js";
import { ApiResponse } from "../../../../../lib/api.response.js";

export class LocationController {
    static async listStockLocation(c: Context) {
        const query = QueryLocationSchema.parse(c.req.query());
        const result = await LocationService.listStockLocation(query);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async listLocations(c: Context) {
        const result = await LocationService.listAllLocations();
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
