import { Context } from "hono";
import { FinanceAPService } from "./ap.service.js";
import { QueryAPSchema, PayAPSchema } from "./ap.schema.js";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";

function parseId(c: Context): number {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid resource ID.");
    return id;
}

export class FinanceAPController {
    static async list(c: Context) {
        const query = QueryAPSchema.parse(c.req.query());
        const result = await FinanceAPService.list(query);
        return ApiResponse.sendSuccess(c, result);
    }

    static async detail(c: Context) {
        const id = parseId(c);
        const result = await FinanceAPService.detail(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async recordPayment(c: Context) {
        const id = parseId(c);
        const dto = c.get("body") as ReturnType<typeof PayAPSchema.parse>;
        const userId = c.get("userId") as string;
        const result = await FinanceAPService.recordPayment(id, dto, userId);
        return ApiResponse.sendSuccess(c, result);
    }
}
