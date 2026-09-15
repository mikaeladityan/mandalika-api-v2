import type { Context } from "hono";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { IssuanceService } from "./issuance.service.js";
import { QueryIssuanceSchema, RequestIssuanceDTO } from "./issuance.schema.js";

export class IssuanceController {
    static async list(c: Context) {
        const query = QueryIssuanceSchema.parse(c.req.query());
        return ApiResponse.sendSuccess(c, await IssuanceService.list(query), 200, query);
    }

    static async grid(c: Context) {
        const query = QueryIssuanceSchema.parse(c.req.query());
        return ApiResponse.sendSuccess(c, await IssuanceService.grid(query), 200, query);
    }

    static async detail(c: Context) {
        const id = Number(c.req.param("id"));
        if (!Number.isInteger(id) || id < 1) throw new ApiError(400, "ID ISSUANCE tidak valid");
        return ApiResponse.sendSuccess(c, await IssuanceService.detail(id));
    }

    static async create(c: Context) {
        return ApiResponse.sendSuccess(c, await IssuanceService.create(c.get("body") as RequestIssuanceDTO), 201);
    }

    static async update(c: Context) {
        const id = Number(c.req.param("id"));
        if (!Number.isInteger(id) || id < 1) throw new ApiError(400, "ID ISSUANCE tidak valid");
        return ApiResponse.sendSuccess(c, await IssuanceService.update(id, c.get("body") as RequestIssuanceDTO));
    }
}
