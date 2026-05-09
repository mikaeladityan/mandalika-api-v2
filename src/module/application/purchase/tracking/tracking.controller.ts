import { Context } from "hono";
import { TrackingService } from "./tracking.service.js";
import { QueryTrackingSchema, UpdateTrackingDTO } from "./tracking.schema.js";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";

function parsePoId(c: Context): number {
    const id = Number(c.req.param("po_id"));
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid PO ID.");
    return id;
}

function getUserId(c: Context): string {
    const user = c.get("user");
    const session = c.get("session");
    return user?.id || session?.email || "system";
}

export class TrackingController {
    static async list(c: Context) {
        const query = QueryTrackingSchema.parse(c.req.query());
        const result = await TrackingService.list(query);
        return ApiResponse.sendSuccess(c, result);
    }

    static async detail(c: Context) {
        const poId = parsePoId(c);
        const result = await TrackingService.detail(poId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async update(c: Context) {
        const poId = parsePoId(c);
        const userId = getUserId(c);
        const valid = c.get("body") as UpdateTrackingDTO;
        const result = await TrackingService.update(poId, valid, userId);
        return ApiResponse.sendSuccess(c, result);
    }
}
