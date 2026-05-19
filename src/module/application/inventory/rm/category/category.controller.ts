import { Context } from "hono";
import { ZodError } from "zod";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { RawMatCategoryService } from "./category.service.js";
import {
    ChangeStatusRawMatCategoryDTO,
    IdParamSchema,
    QueryRawMatCategoryDTO,
    QueryRawMatCategorySchema,
    RequestRawMatCategoryDTO,
    UpdateRawMatCategoryDTO,
} from "./category.schema.js";

function parseId(c: Context): number {
    try {
        return IdParamSchema.parse({ id: c.req.param("id") }).id;
    } catch (e) {
        if (e instanceof ZodError) throw new ApiError(400, "ID category tidak valid");
        throw e;
    }
}

export class RawMatCategoryController {
    static async create(c: Context) {
        const body = c.get("body") as RequestRawMatCategoryDTO;
        const result = await RawMatCategoryService.create(body);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async update(c: Context) {
        const id = parseId(c);
        const body = c.get("body") as UpdateRawMatCategoryDTO;
        const result = await RawMatCategoryService.update(id, body);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async changeStatus(c: Context) {
        const id = parseId(c);
        const { status } = c.get("body") as ChangeStatusRawMatCategoryDTO;
        const result = await RawMatCategoryService.changeStatus(id, status);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async detail(c: Context) {
        const id = parseId(c);
        const result = await RawMatCategoryService.detail(id);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async list(c: Context) {
        const params: QueryRawMatCategoryDTO = QueryRawMatCategorySchema.parse(c.req.query());
        const result = await RawMatCategoryService.list(params);
        return ApiResponse.sendSuccess(c, result, 200, params);
    }

    static async delete(c: Context) {
        const id = parseId(c);
        const result = await RawMatCategoryService.delete(id);
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
