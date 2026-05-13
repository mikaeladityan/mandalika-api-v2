import { Context } from "hono";
import { FinanceCashService } from "./cash.service.js";
import { QueryCashSchema, CreateCashSchema } from "./cash.schema.js";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";

function parseId(c: Context): number {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid resource ID.");
    return id;
}

export class FinanceCashController {
    static async list(c: Context) {
        const query = QueryCashSchema.parse(c.req.query());
        const result = await FinanceCashService.list(query);
        return ApiResponse.sendSuccess(c, result);
    }

    static async detail(c: Context) {
        const id = parseId(c);
        const result = await FinanceCashService.detail(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async create(c: Context) {
        const dto = c.get("body") as ReturnType<typeof CreateCashSchema.parse>;
        const userId = c.get("userId") as string;
        const result = await FinanceCashService.create(dto, userId);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async post(c: Context) {
        const id = parseId(c);
        const userId = c.get("userId") as string;
        const result = await FinanceCashService.post(id, userId);
        return ApiResponse.sendSuccess(c, result);
    }
}
