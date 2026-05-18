import { Context } from "hono";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { QueryFGTypeSchema, RequestFGTypeDTO } from "./type.schema.js";
import { FGTypeService } from "./type.service.js";

export class FGTypeController {
    static async create(c: Context) {
        const body = c.get("body") as RequestFGTypeDTO;
        const result = await FGTypeService.create(body);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async list(c: Context) {
        const parsed = QueryFGTypeSchema.safeParse(c.req.query());
        if (!parsed.success) throw new ApiError(400, "Query tidak valid");

        const result = await FGTypeService.list(parsed.data);
        return ApiResponse.sendSuccess(c, result, 200, parsed.data);
    }

    static async update(c: Context) {
        const id = Number(c.req.param("id"));
        if (!Number.isInteger(id) || id < 1) throw new ApiError(400, "ID tidak valid");

        const body = c.get("body") as Partial<RequestFGTypeDTO>;
        const result = await FGTypeService.update(id, body);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async delete(c: Context) {
        const id = Number(c.req.param("id"));
        if (!Number.isInteger(id) || id < 1) throw new ApiError(400, "ID tidak valid");

        await FGTypeService.delete(id);
        return ApiResponse.sendSuccess(c, {}, 200);
    }
}
