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
            vendor_id: query.vendor_id ? Number(query.vendor_id) : undefined,
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
        const valid = CreateRFQSchema.parse(body);
        const result = await RFQService.create(valid);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async update(c: Context) {
        const id = Number(c.req.param("id"));
        const body = await c.req.json();
        const valid = UpdateRFQSchema.parse(body);
        const result = await RFQService.update(id, valid);
        return ApiResponse.sendSuccess(c, result);
    }

    static async updateStatus(c: Context) {
        const id = Number(c.req.param("id"));
        const body = await c.req.json();
        const valid = UpdateRFQStatusSchema.parse(body);
        const result = await RFQService.updateStatus(id, valid);
        return ApiResponse.sendSuccess(c, result);
    }

    static async convertToPO(c: Context) {
        const id = Number(c.req.param("id"));
        const body = await c.req.json();
        const valid = ConvertToPOSchema.parse(body);
        const result = await RFQService.convertToPO(id, valid);
        return ApiResponse.sendSuccess(c, result);
    }

    static async destroy(c: Context) {
        const id = Number(c.req.param("id"));
        await RFQService.destroy(id);
        return ApiResponse.sendSuccess(c, { message: "RFQ deleted successfully" });
    }
}
