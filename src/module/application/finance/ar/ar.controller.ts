import { Context } from "hono";
import { FinanceARService } from "./ar.service.js";
import { QueryARSchema, ReceiveARSchema, CreateARSchema } from "./ar.schema.js";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";

function parseId(c: Context): number {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid resource ID.");
    return id;
}

export class FinanceARController {
    static async list(c: Context) {
        const query = QueryARSchema.parse(c.req.query());
        const result = await FinanceARService.list(query);
        return ApiResponse.sendSuccess(c, result);
    }

    static async detail(c: Context) {
        const id = parseId(c);
        const result = await FinanceARService.detail(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async recordReceipt(c: Context) {
        const id = parseId(c);
        const dto = c.get("body") as ReturnType<typeof ReceiveARSchema.parse>;
        const userId = c.get("userId") as string;
        const result = await FinanceARService.recordReceipt(id, dto, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async create(c: Context) {
        const dto = c.get("body") as ReturnType<typeof CreateARSchema.parse>;
        const userId = c.get("userId") as string;
        const result = await FinanceARService.create(dto, userId);
        return ApiResponse.sendSuccess(c, result, 201);
    }
}
