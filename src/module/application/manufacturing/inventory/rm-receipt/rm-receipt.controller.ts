import { Context } from "hono";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { 
    QueryRmReceiptDTO, 
    UpdateRmReceiptItemSchema, 
    UpdateRmStatusSchema 
} from "./rm-receipt.schema.js";
import { RmReceiptService } from "./rm-receipt.service.js";

export class RmReceiptController {
    static async list(c: Context) {
        const query = c.req.query() as any as QueryRmReceiptDTO;
        const result = await RmReceiptService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async detail(c: Context) {
        const id = c.req.param("id");
        const result = await RmReceiptService.detail(Number(id));
        return ApiResponse.sendSuccess(c, result);
    }

    static async updateItems(c: Context) {
        const id = c.req.param("id");
        const body = await c.req.json();
        const payload = UpdateRmReceiptItemSchema.parse(body);
        const user = c.get("user");
        const result = await RmReceiptService.updateItems(Number(id), payload, user?.email || "system");
        return ApiResponse.sendSuccess(c, result);
    }

    static async updateStatus(c: Context) {
        const id = c.req.param("id");
        const body = await c.req.json();
        const payload = UpdateRmStatusSchema.parse(body);
        const user = c.get("user");
        const result = await RmReceiptService.updateStatus(Number(id), payload, user?.email || "system");
        return ApiResponse.sendSuccess(c, result);
    }
}
