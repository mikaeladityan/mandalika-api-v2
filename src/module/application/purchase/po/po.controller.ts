import { Context } from "hono";
import { POService } from "./po.service.js";
import { QueryPOSchema, CreatePOSchema, UpdatePOSchema, UpdatePOStatusSchema, UpdatePOTrackingSchema, ReceiveItemsSchema } from "./po.schema.js";
import { ApiResponse } from "../../../../lib/api.response.js";

export class POController {
    static async list(c: Context) {
        const query = QueryPOSchema.parse(c.req.query());
        const result = await POService.list(query);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async detail(c: Context) {
        const id = Number(c.req.param("id"));
        const result = await POService.detail(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async create(c: Context) {
        const user = c.get("user");
        const session = c.get("session");
        const userId = user?.id || session?.email || "system";
        const body = await c.req.json();
        const validated = CreatePOSchema.parse(body);
        const result = await POService.create(validated, userId);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async update(c: Context) {
        const user = c.get("user");
        const session = c.get("session");
        const userId = user?.id || session?.email || "system";
        const id = Number(c.req.param("id"));
        const body = await c.req.json();
        const validated = UpdatePOSchema.parse(body);
        const result = await POService.update(id, validated, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async updateStatus(c: Context) {
        const user = c.get("user");
        const session = c.get("session");
        const userId = user?.id || session?.email || "system";
        const id = Number(c.req.param("id"));
        const body = await c.req.json();
        const validated = UpdatePOStatusSchema.parse(body);
        const result = await POService.updateStatus(id, validated, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async updateTracking(c: Context) {
        const user = c.get("user");
        const session = c.get("session");
        const userId = user?.id || session?.email || "system";
        const id = Number(c.req.param("id"));
        const body = await c.req.json();
        const validated = UpdatePOTrackingSchema.parse(body);
        const result = await POService.updateTracking(id, validated, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async receiveItems(c: Context) {
        const user = c.get("user");
        const session = c.get("session");
        const userId = user?.id || session?.email || "system";
        const id = Number(c.req.param("id"));
        const body = await c.req.json();
        const validated = ReceiveItemsSchema.parse(body);
        const result = await POService.receiveItems(id, validated, userId);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async listReceipts(c: Context) {
        const id = Number(c.req.param("id"));
        const result = await POService.listReceipts(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async destroy(c: Context) {
        const id = Number(c.req.param("id"));
        const result = await POService.destroy(id);
        return ApiResponse.sendSuccess(c, result);
    }
}
