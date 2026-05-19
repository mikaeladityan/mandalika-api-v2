import { Context } from "hono";
import { ZodError } from "zod";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { UnitRawMaterialService } from "./unit.service.js";
import {
    IdParamSchema,
    QueryRawMaterialUnitDTO,
    QueryRawMaterialUnitSchema,
    RequestRawMaterialUnitDTO,
    UpdateRawMaterialUnitDTO,
} from "./unit.schema.js";

function parseId(c: Context): number {
    try {
        return IdParamSchema.parse({ id: c.req.param("id") }).id;
    } catch (e) {
        if (e instanceof ZodError) throw new ApiError(400, "ID unit tidak valid");
        throw e;
    }
}

export class UnitRawMaterialController {
    static async create(c: Context) {
        const body = c.get("body") as RequestRawMaterialUnitDTO;
        const result = await UnitRawMaterialService.create(body);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async update(c: Context) {
        const id = parseId(c);
        const body = c.get("body") as UpdateRawMaterialUnitDTO;
        const result = await UnitRawMaterialService.update(id, body);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async detail(c: Context) {
        const id = parseId(c);
        const result = await UnitRawMaterialService.detail(id);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async list(c: Context) {
        const params: QueryRawMaterialUnitDTO = QueryRawMaterialUnitSchema.parse(c.req.query());
        const result = await UnitRawMaterialService.list(params);
        return ApiResponse.sendSuccess(c, result, 200, params);
    }

    static async delete(c: Context) {
        const id = parseId(c);
        const result = await UnitRawMaterialService.delete(id);
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
