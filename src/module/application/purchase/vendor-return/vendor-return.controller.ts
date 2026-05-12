import { Context } from "hono";
import { VendorReturnService } from "./vendor-return.service.js";
import { QueryVendorReturnSchema, CreateVendorReturnDTO, UpdateVendorReturnDTO } from "./vendor-return.schema.js";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";

function parseId(c: Context): number {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid resource ID.");
    return id;
}

function getUserId(c: Context): string {
    const user = c.get("user");
    const session = c.get("session");
    const id = user?.id || session?.email;
    if (!id) throw new ApiError(401, "Unauthorized");
    return id;
}

export class VendorReturnController {
    static async list(c: Context) {
        const query = QueryVendorReturnSchema.parse(c.req.query());
        const result = await VendorReturnService.list(query);
        return ApiResponse.sendSuccess(c, result);
    }

    static async detail(c: Context) {
        const id = parseId(c);
        const result = await VendorReturnService.detail(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async create(c: Context) {
        const userId = getUserId(c);
        const valid = c.get("body") as CreateVendorReturnDTO;
        const result = await VendorReturnService.create(valid, userId);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async update(c: Context) {
        const id = parseId(c);
        const userId = getUserId(c);
        const valid = c.get("body") as UpdateVendorReturnDTO;
        const result = await VendorReturnService.update(id, valid, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async post(c: Context) {
        const id = parseId(c);
        const userId = getUserId(c);
        const result = await VendorReturnService.post(id, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async approve(c: Context) {
        const id = parseId(c);
        const userId = getUserId(c);
        const result = await VendorReturnService.approve(id, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async destroy(c: Context) {
        const id = parseId(c);
        await VendorReturnService.destroy(id);
        return ApiResponse.sendSuccess(c, { message: "Vendor return deleted successfully" });
    }
}
