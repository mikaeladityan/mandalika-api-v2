import { Context } from "hono";
import { TypeService } from "./type.service.js";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { QueryTypeDTO } from "./type.schema.js";

function parseId(raw: string | undefined): number {
    if (!raw) throw new ApiError(400, "ID wajib dilampirkan");
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "ID tidak valid");
    return id;
}

export class TypeController {
    static async create(c: Context) {
        const body = c.get("body");
        const result = await TypeService.create(body);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async list(c: Context) {
        const { search, page, take } = c.req.query();

        const query: QueryTypeDTO = {
            search,
            page: page ? Number(page) : undefined,
            take: take ? Number(take) : undefined,
        };

        const result = await TypeService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async update(c: Context) {
        const id = parseId(c.req.param("id"));
        const body = c.get("body");

        const result = await TypeService.update(id, body);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async delete(c: Context) {
        const id = parseId(c.req.param("id"));

        await TypeService.delete(id);
        return ApiResponse.sendSuccess(c, {}, 200);
    }
}
