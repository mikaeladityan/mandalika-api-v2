import { Context } from "hono";
import { CreateGoodsReceiptSchema, QueryGoodsReceiptSchema } from "./gr.schema.js";
import { GoodsReceiptService } from "./gr.service.js";
import { ApiResponse } from "../../../../lib/api.response.js";

export class GoodsReceiptController {
    static async create(c: Context) {
        const body = await c.req.json();
        const validated = CreateGoodsReceiptSchema.parse(body);
        const userId = c.get("user")?.email || "system";
        const result = await GoodsReceiptService.create(validated, userId);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async list(c: Context) {
        const query = c.req.query();
        const validated = QueryGoodsReceiptSchema.parse(query);
        const result = await GoodsReceiptService.list(validated);
        return ApiResponse.sendSuccess(c, result);
    }

    static async detail(c: Context) {
        const id = Number(c.req.param("id"));
        const result = await GoodsReceiptService.detail(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async post(c: Context) {
        const id = Number(c.req.param("id"));
        const userId = c.get("user")?.email || "system";
        const result = await GoodsReceiptService.post(id, userId);
        return ApiResponse.sendSuccess(c, result);
    }

    static async cancel(c: Context) {
        const id = Number(c.req.param("id"));
        const result = await GoodsReceiptService.cancel(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async export(c: Context) {
        const query = c.req.query();
        const validated = QueryGoodsReceiptSchema.parse(query);
        const buffer = await GoodsReceiptService.export(validated);

        c.header(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        c.header("Content-Disposition", `attachment; filename="data-barang-masuk.xlsx"`);
        return c.body(buffer as any);
    }

    static async exportDetail(c: Context) {
        const id = Number(c.req.param("id"));
        const gr = await GoodsReceiptService.detail(id);
        const buffer = await GoodsReceiptService.exportDetail(id);

        c.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        c.header("Content-Disposition", `attachment; filename="GR-${gr.gr_number}.xlsx"`);
        return c.body(buffer as any);
    }
}
