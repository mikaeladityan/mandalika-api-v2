import { Context } from "hono";
import { POService } from "./po.service.js";
import { QueryPOSchema, CreatePOSchema, UpdatePOSchema, UpdatePOStatusSchema } from "./po.schema.js";
import { ApiResponse } from "../../../../lib/api.response.js";

export class POController {
    static async list(c: Context) {
        const query = QueryPOSchema.parse(c.req.query());
        const result = await POService.list(query);
        return ApiResponse.sendSuccess(c, result.data, 200, {
            total: result.total,
            page: query.page,
            take: query.take,
        });
    }

    static async detail(c: Context) {
        const id = Number(c.req.param("id"));
        const result = await POService.detail(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async create(c: Context) {
        const user = c.get("user");
        const body = await c.req.json();
        const validated = CreatePOSchema.parse(body);
        const result = await POService.create(validated, user.id);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async update(c: Context) {
        const user = c.get("user");
        const id = Number(c.req.param("id"));
        const body = await c.req.json();
        const validated = UpdatePOSchema.parse(body);
        const result = await POService.update(id, validated, user.id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async updateStatus(c: Context) {
        const user = c.get("user");
        const id = Number(c.req.param("id"));
        const body = await c.req.json();
        const validated = UpdatePOStatusSchema.parse(body);
        const result = await POService.updateStatus(id, validated, user.id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async destroy(c: Context) {
        const id = Number(c.req.param("id"));
        const result = await POService.destroy(id);
        return ApiResponse.sendSuccess(c, result);
    }
}
