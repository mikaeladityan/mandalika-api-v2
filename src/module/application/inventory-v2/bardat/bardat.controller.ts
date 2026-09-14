import type { Context } from "hono";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { BardatService } from "./bardat.service.js";
import { QueryBardatSchema, RequestBardatDTO } from "./bardat.schema.js";

export class BardatController {
    static async list(c: Context) {
        const query = QueryBardatSchema.parse(c.req.query());
        return ApiResponse.sendSuccess(c, await BardatService.list(query), 200, query);
    }

    static async grid(c: Context) {
        const query = QueryBardatSchema.parse(c.req.query());
        return ApiResponse.sendSuccess(c, await BardatService.grid(query), 200, query);
    }

    static async detail(c: Context) {
        const id = Number(c.req.param("id"));
        if (!Number.isInteger(id) || id < 1) throw new ApiError(400, "ID BARDAT tidak valid");
        return ApiResponse.sendSuccess(c, await BardatService.detail(id));
    }

    static async create(c: Context) {
        return ApiResponse.sendSuccess(c, await BardatService.create(c.get("body") as RequestBardatDTO), 201);
    }

    static async update(c: Context) {
        const id = Number(c.req.param("id"));
        if (!Number.isInteger(id) || id < 1) throw new ApiError(400, "ID BARDAT tidak valid");
        return ApiResponse.sendSuccess(c, await BardatService.update(id, c.get("body") as RequestBardatDTO));
    }
}
