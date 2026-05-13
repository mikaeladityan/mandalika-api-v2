import { Context } from "hono";
import { FinanceJournalService } from "./journal.service.js";
import { QueryJournalSchema, CreateJournalSchema } from "./journal.schema.js";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";

function parseId(c: Context): number {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid resource ID.");
    return id;
}

export class FinanceJournalController {
    static async list(c: Context) {
        const query = QueryJournalSchema.parse(c.req.query());
        const result = await FinanceJournalService.list(query);
        return ApiResponse.sendSuccess(c, result);
    }

    static async detail(c: Context) {
        const id = parseId(c);
        const result = await FinanceJournalService.detail(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async create(c: Context) {
        const dto = c.get("body") as ReturnType<typeof CreateJournalSchema.parse>;
        const userId = c.get("userId") as string;
        const result = await FinanceJournalService.create(dto, userId);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async post(c: Context) {
        const id = parseId(c);
        const userId = c.get("userId") as string;
        const result = await FinanceJournalService.post(id, userId);
        return ApiResponse.sendSuccess(c, result);
    }
}
