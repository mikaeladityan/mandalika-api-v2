import { Context } from "hono";
import { ZodError } from "zod";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { SupplierService } from "./supplier.service.js";
import {
    BulkDeleteSupplierDTO,
    IdParamSchema,
    QuerySupplierDTO,
    QuerySupplierSchema,
    RequestSupplierDTO,
} from "./supplier.schema.js";

function parseId(c: Context): number {
    try {
        return IdParamSchema.parse({ id: c.req.param("id") }).id;
    } catch (e) {
        if (e instanceof ZodError) throw new ApiError(400, "ID supplier tidak valid");
        throw e;
    }
}

export class SupplierController {
    static async create(c: Context) {
        const body = c.get("body") as RequestSupplierDTO;
        const result = await SupplierService.create(body);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async update(c: Context) {
        const id = parseId(c);
        const body = c.get("body") as Partial<RequestSupplierDTO>;
        const result = await SupplierService.update(id, body);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async detail(c: Context) {
        const id = parseId(c);
        const result = await SupplierService.detail(id);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async delete(c: Context) {
        const id = parseId(c);
        const result = await SupplierService.delete(id);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async bulkDelete(c: Context) {
        const { ids } = c.get("body") as BulkDeleteSupplierDTO;
        const result = await SupplierService.bulkDelete(ids);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async list(c: Context) {
        const params: QuerySupplierDTO = QuerySupplierSchema.parse(c.req.query());
        const result = await SupplierService.list(params);
        return ApiResponse.sendSuccess(c, result, 200, params);
    }
}
