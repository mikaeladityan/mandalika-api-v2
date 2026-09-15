import type { Context } from "hono";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { BardatCycleService } from "./bardat.cycle.service.js";
import { QueryBardatCycleSchema, RequestBardatCycleSchema } from "./bardat.cycle.schema.js";

export class BardatCycleController {
    static async reset(c: Context) {
        const outletId = Number(c.req.param("outletId"));
        if (!Number.isInteger(outletId) || outletId < 1) throw new ApiError(400, "ID toko tidak valid");
        return ApiResponse.sendSuccess(c, await BardatCycleService.reset(outletId));
    }
    static async list(c: Context) {
        return ApiResponse.sendSuccess(c, await BardatCycleService.list(QueryBardatCycleSchema.parse(c.req.query())));
    }
    static async save(c: Context) {
        const body: unknown = await c.req.json().catch(() => null);
        const parsed = RequestBardatCycleSchema.safeParse(body);
        if (!parsed.success) throw new ApiError(400, "Pola pengiriman tidak valid", parsed.error.issues);
        return ApiResponse.sendSuccess(c, await BardatCycleService.save(parsed.data));
    }
}
