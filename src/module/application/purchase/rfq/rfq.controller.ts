import { Context } from "hono";
import {
    QueryRFQSchema,
    CreateRFQDTO,
    UpdateRFQDTO,
    UpdateRFQStatusDTO,
    ConvertToPODTO,
} from "./rfq.schema.js";
import { RFQService } from "./rfq.service.js";
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

export class RFQController {
    static async list(c: Context) {
        const query = c.req.query();
        const validQuery = QueryRFQSchema.parse({
            ...query,
            page: query.page ? Number(query.page) : undefined,
            take: query.take ? Number(query.take) : undefined,
            supplier_id: query.supplier_id ? Number(query.supplier_id) : undefined,
            month: query.month ? Number(query.month) : undefined,
            year: query.year ? Number(query.year) : undefined,
        });
        const result = await RFQService.list(validQuery);
        return ApiResponse.sendSuccess(c, result);
    }

    static async detail(c: Context) {
        const id = parseId(c);
        const result = await RFQService.detail(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async create(c: Context) {
        const userId = getUserId(c);
        const valid = c.get("body") as CreateRFQDTO;
        const result = await RFQService.create(valid, userId);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async update(c: Context) {
        const id = parseId(c);
        const userId = getUserId(c);
        const valid = c.get("body") as UpdateRFQDTO;
        const result = await RFQService.update(id, valid, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async updateStatus(c: Context) {
        const id = parseId(c);
        const userId = getUserId(c);
        const valid = c.get("body") as UpdateRFQStatusDTO;
        const result = await RFQService.updateStatus(id, valid, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async destroy(c: Context) {
        const id = parseId(c);
        await RFQService.destroy(id);
        return ApiResponse.sendSuccess(c, { message: "RFQ deleted successfully" });
    }

    static async convertToPO(c: Context) {
        const id = parseId(c);
        const userId = getUserId(c);
        const valid = c.get("body") as ConvertToPODTO;
        const result = await RFQService.convertToPO(id, valid, userId);
        return ApiResponse.sendSuccess(c, result);
    }
}
