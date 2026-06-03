import { Context } from "hono";
import { ProductSizeService } from "./size.service.js";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { QuerySizeDTO } from "./size.schema.js";

function parseId(raw: string | undefined): number {
    if (!raw) throw new ApiError(400, "ID wajib dilampirkan");
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "ID tidak valid");
    return id;
}

export class ProductSizeController {
    static async create(c: Context) {
        const body = c.get("body");
        const result = await ProductSizeService.create(body);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async list(c: Context) {
        const { search, page, take } = c.req.query();

        const query: QuerySizeDTO = {
            search: search ? Number(search) : undefined,
            page: page ? Number(page) : undefined,
            take: take ? Number(take) : undefined,
        };

        const result = await ProductSizeService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async update(c: Context) {
        const id = parseId(c.req.param("id"));
        const body = c.get("body");

        const result = await ProductSizeService.update(id, body);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async delete(c: Context) {
        const id = parseId(c.req.param("id"));

        await ProductSizeService.delete(id);
        return ApiResponse.sendSuccess(c, {}, 200);
    }
}
