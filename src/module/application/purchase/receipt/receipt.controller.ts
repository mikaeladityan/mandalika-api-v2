import { Context } from "hono";
import { ReceiptService } from "./receipt.service.js";
import { QueryReceiptSchema, QueryOpenPOForReceiptSchema, CreateReceiptDTO, UpdateReceiptDTO } from "./receipt.schema.js";
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

export class ReceiptController {
    static async list(c: Context) {
        const query = QueryReceiptSchema.parse(c.req.query());
        const result = await ReceiptService.list(query);
        return ApiResponse.sendSuccess(c, result);
    }

    static async listOpenPOs(c: Context) {
        const query = QueryOpenPOForReceiptSchema.parse(c.req.query());
        const result = await ReceiptService.listOpenPOs(query);
        return ApiResponse.sendSuccess(c, result);
    }

    static async detail(c: Context) {
        const id = parseId(c);
        const result = await ReceiptService.detail(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async create(c: Context) {
        const userId = getUserId(c);
        const valid = c.get("body") as CreateReceiptDTO;
        const result = await ReceiptService.create(valid, userId);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async update(c: Context) {
        const id = parseId(c);
        const userId = getUserId(c);
        const valid = c.get("body") as UpdateReceiptDTO;
        const result = await ReceiptService.update(id, valid, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async post(c: Context) {
        const id = parseId(c);
        const userId = getUserId(c);
        const result = await ReceiptService.post(id, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async approve(c: Context) {
        const id = parseId(c);
        const userId = getUserId(c);
        const result = await ReceiptService.approve(id, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async destroy(c: Context) {
        const id = parseId(c);
        await ReceiptService.destroy(id);
        return ApiResponse.sendSuccess(c, { message: "Receipt deleted successfully" });
    }
}
