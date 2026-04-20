import { Context } from "hono";
import { RmTransferService } from "./rm-transfer.service.js";
import { ApiResponse } from "../../../../../lib/api.response.js";

export class RmTransferController {
    static async list(c: Context) {
        const query = c.req.query();
        const result = await RmTransferService.list(query as any);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async detail(c: Context) {
        const id = Number(c.req.param("id"));
        const result = await RmTransferService.detail(id);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async create(c: Context) {
        const body = await c.req.json();
        const userId = c.get("user")?.id || "system";
        const result = await RmTransferService.create(body, userId);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async updateStatus(c: Context) {
        const id = Number(c.req.param("id"));
        const body = await c.req.json();
        const userId = c.get("user")?.id || "system";
        const result = await RmTransferService.updateStatus(id, body, userId);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async stockCheck(c: Context) {
        const query = c.req.query();
        const result = await RmTransferService.stockCheck(query);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async cleanCancelled(c: Context) {
        const result = await RmTransferService.cleanCancelled();
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
