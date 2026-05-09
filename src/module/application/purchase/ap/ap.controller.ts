import { Context } from "hono";
import { APService } from "./ap.service.js";
import { QueryAPSchema, UpdateAPPaymentDTO } from "./ap.schema.js";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";

function parseId(c: Context): number {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid resource ID.");
    return id;
}

export class APController {
    static async list(c: Context) {
        const query = QueryAPSchema.parse(c.req.query());
        const result = await APService.list(query);
        return ApiResponse.sendSuccess(c, result);
    }

    static async detail(c: Context) {
        const id = parseId(c);
        const result = await APService.detail(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async updatePayment(c: Context) {
        const id = parseId(c);
        const valid = c.get("body") as UpdateAPPaymentDTO;
        const result = await APService.updatePayment(id, valid);
        return ApiResponse.sendSuccess(c, result);
    }
}
