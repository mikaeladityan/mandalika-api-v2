import { Context } from "hono";
import {
    QueryRFQSchema,
    CreateRFQSchema,
    UpdateRFQSchema,
    UpdateRFQStatusSchema,
    ConvertToPOSchema,
} from "./rfq.schema.js";
import { RFQService } from "./rfq.service.js";
import { ApiResponse } from "../../../../lib/api.response.js";

export class RFQController {
    static async list(c: Context) {
        const query = c.req.query();
        const validQuery = QueryRFQSchema.parse({
            ...query,
            page: query.page ? Number(query.page) : undefined,
            take: query.take ? Number(query.take) : undefined,
            supplier_id: query.supplier_id ? Number(query.supplier_id) : undefined,
            month: query.month ? Number(query.month) : undefined,
            year: query.year ? Number(query.year) : undefined,
        });
        const result = await RFQService.list(validQuery);
        return ApiResponse.sendSuccess(c, result);
    }

    static async detail(c: Context) {
        const id = Number(c.req.param("id"));
        const result = await RFQService.detail(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async create(c: Context) {
        const body = await c.req.json();
        const user = c.get("user");
        const session = c.get("session");
        const userId = user?.id || session?.email || "system";
        
        const valid = CreateRFQSchema.parse(body);
        const result = await RFQService.create(valid, userId);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async update(c: Context) {
        const id = Number(c.req.param("id"));
        const body = await c.req.json();
        const user = c.get("user");
        const session = c.get("session");
        const userId = user?.id || session?.email || "system";

        const valid = UpdateRFQSchema.parse(body);
        const result = await RFQService.update(id, valid, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async updateStatus(c: Context) {
        const id = Number(c.req.param("id"));
        const body = await c.req.json();
        const user = c.get("user");
        const valid = UpdateRFQStatusSchema.parse(body);
        const result = await RFQService.updateStatus(id, valid, user.id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async destroy(c: Context) {
        const id = Number(c.req.param("id"));
        await RFQService.destroy(id);
        return ApiResponse.sendSuccess(c, { message: "RFQ deleted successfully" });
    }

    static async convertToPO(c: Context) {
        const id = Number(c.req.param("id"));
        const body = await c.req.json();
        const user = c.get("user");
        const valid = ConvertToPOSchema.parse(body);
        const result = await RFQService.convertToPO(id, valid, user.id);
        return ApiResponse.sendSuccess(c, result);
    }
}
