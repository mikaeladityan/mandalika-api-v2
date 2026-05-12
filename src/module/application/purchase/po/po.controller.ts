import { Context } from "hono";
import { POService } from "./po.service.js";
import { QueryPOSchema, QueryOpenPOSchema, CreatePODTO, UpdatePODTO, UpdatePOStatusDTO, UpdatePOTrackingDTO } from "./po.schema.js";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";

function parseId(c: Context): number {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError(400, "Invalid resource ID.");
    }
    return id;
}

function getUserId(c: Context): string {
    const user = c.get("user");
    const session = c.get("session");
    const id = user?.id || session?.email;
    if (!id) throw new ApiError(401, "Unauthorized");
    return id;
}

export class POController {
    static async list(c: Context) {
        const query = QueryPOSchema.parse(c.req.query());
        const result = await POService.list(query);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async detail(c: Context) {
        const id = parseId(c);
        const result = await POService.detail(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async create(c: Context) {
        const userId = getUserId(c);
        const validated = c.get("body") as CreatePODTO;
        const result = await POService.create(validated, userId);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async update(c: Context) {
        const userId = getUserId(c);
        const id = parseId(c);
        const validated = c.get("body") as UpdatePODTO;
        const result = await POService.update(id, validated, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async updateStatus(c: Context) {
        const userId = getUserId(c);
        const id = parseId(c);
        const validated = c.get("body") as UpdatePOStatusDTO;
        const result = await POService.updateStatus(id, validated, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async updateTracking(c: Context) {
        const userId = getUserId(c);
        const id = parseId(c);
        const validated = c.get("body") as UpdatePOTrackingDTO;
        const result = await POService.updateTracking(id, validated, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async listReceipts(c: Context) {
        const id = parseId(c);
        const result = await POService.listReceipts(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async listOpenPO(c: Context) {
        const query = QueryOpenPOSchema.parse(c.req.query());
        const result = await POService.listOpenPO(query);
        return ApiResponse.sendSuccess(c, result);
    }

    static async destroy(c: Context) {
        const id = parseId(c);
        const result = await POService.destroy(id);
        return ApiResponse.sendSuccess(c, result);
    }
}
