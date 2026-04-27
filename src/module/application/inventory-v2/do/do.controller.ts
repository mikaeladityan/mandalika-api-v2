import { Context } from "hono";
import { DOService } from "./do.service.js";
import { 
    QueryDeliveryOrderSchema, 
    RequestDeliveryOrderDTO, 
    UpdateDeliveryOrderStatusDTO,
    RequestUpdateDeliveryOrderSchema,
    RequestUpdateDeliveryOrderDTO,
} from "./do.schema.js";
import { ApiResponse } from "../../../../lib/api.response.js";
import { CreateLogger } from "../../shared/activity-logger.js";
import { CreateLoggingActivityDTO } from "../../shared/activity-logger.js";
import { ApiError } from "../../../../lib/errors/api.error.js";

const Table = "Delivery Order";

export class DOController {
    static async list(c: Context) {
        const query = c.req.query();
        const validated = QueryDeliveryOrderSchema.parse(query);
        const result = await DOService.list(validated);
        return ApiResponse.sendSuccess(c, result, 200, validated);
    }
    
    static async getStock(c: Context) {
        const warehouse_id = c.req.query("warehouse_id") ? Number(c.req.query("warehouse_id")) : undefined;
        const outlet_id = c.req.query("outlet_id") ? Number(c.req.query("outlet_id")) : undefined;
        const product_id = Number(c.req.query("product_id"));
        
        if (!product_id || (!warehouse_id && !outlet_id)) {
            throw new ApiError(400, "Product ID dan salah satu dari Warehouse ID atau Outlet ID wajib dikirim.");
        }
        
        const stock = await DOService.getStock(warehouse_id, outlet_id, product_id);
        return ApiResponse.sendSuccess(c, { stock }, 200);
    }

    static async detail(c: Context) {
        const id = Number(c.req.param("id"));
        if (!id) throw new ApiError(400, "Kesalahan pada proses permintaan data");
        const result = await DOService.detail(id);
        return ApiResponse.sendSuccess(c, result);
    }

    static async create(c: Context) {
        const body = c.get("body") as RequestDeliveryOrderDTO;
        const accountSession = c.get("session");
        const userId = accountSession?.email || "system";

        const result = await DOService.create(body, userId);

        if (result) {
            const log: CreateLoggingActivityDTO = {
                activity: "CREATE",
                description: `${Table} ${result.transfer_number} dibuat (Gudang: ${result.from_warehouse?.name || result.from_warehouse_id} -> Outlet: ${result.to_outlet?.name || result.to_outlet_id})`,
                email: userId,
            };
            await CreateLogger(log);
        }

        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async updateStatus(c: Context) {
        const id = Number(c.req.param("id"));
        if (!id) throw new ApiError(400, "Kesalahan pada proses permintaan data");
        
        const body = c.get("body") as UpdateDeliveryOrderStatusDTO;
        const accountSession = c.get("session");
        const userId = accountSession?.email || "system";

        const result = await DOService.updateStatus(id, body, userId);

        if (result) {
            const log: CreateLoggingActivityDTO = {
                activity: "UPDATE",
                description: `Update Status ${Table} ${result.transfer_number} menjadi ${result.status}`,
                email: userId,
            };
            await CreateLogger(log);
        }

        return ApiResponse.sendSuccess(c, result);
    }

    static async export(c: Context) {
        const query = c.req.query();
        const validated = QueryDeliveryOrderSchema.parse(query);
        const csv = await DOService.export(validated);

        c.header("Content-Type", "text/csv; charset=utf-8");
        c.header("Content-Disposition", `attachment; filename="DO_Export_${Date.now()}.csv"`);

        return c.text(csv as any);
    }

    static async update(c: Context) {
        const id = Number(c.req.param("id"));
        if (!id) throw new ApiError(400, "Kesalahan pada proses permintaan data");
        
        const body = await c.req.json();
        const validated = RequestUpdateDeliveryOrderSchema.parse(body);
        const accountSession = c.get("session");
        const userId = accountSession?.email || "system";

        const result = await DOService.update(id, validated, userId);

        if (result) {
            const log: CreateLoggingActivityDTO = {
                activity: "UPDATE",
                description: `Update Data ${Table} ${result.transfer_number}`,
                email: userId,
            };
            await CreateLogger(log);
        }

        return ApiResponse.sendSuccess(c, result);
    }
}
