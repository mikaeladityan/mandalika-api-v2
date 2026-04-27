import { Context } from "hono";
import { RmSkuTransferService } from "./rm-sku-transfer.service.js";
import { RequestRmSkuTransferDTO } from "./rm-sku-transfer.schema.js";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { CreateLogger } from "../../../shared/activity-logger.js";

export class RmSkuTransferController {
    static async transfer(c: Context) {
        try {
            const body = c.get("body") as RequestRmSkuTransferDTO;
            const accountSession = c.get("session");
            const userId = accountSession?.email || "system";

            const result = await RmSkuTransferService.transfer(body, userId);

            if (result) {
                const log: any = {
                    activity: "UPDATE",
                    description: `Pindah SKU Stock RM: Dibuat oleh ${userId}`,
                    email: userId,
                };
                await CreateLogger(log);
            }

            return ApiResponse.sendSuccess(c, result, 201);
        } catch (error: any) {
            return ApiResponse.sendError(c, error.statusCode || 500, error.message);
        }
    }

    static async getStock(c: Context) {
        try {
            const rmId = Number(c.req.query("rm_id"));
            const whId = Number(c.req.query("warehouse_id"));

            const result = await RmSkuTransferService.getStock(rmId, whId);
            return ApiResponse.sendSuccess(c, result);
        } catch (error: any) {
            return ApiResponse.sendError(c, error.statusCode || 500, error.message);
        }
    }

    static async getStockAll(c: Context) {
        try {
            const rmId = Number(c.req.query("rm_id"));
            const result = await RmSkuTransferService.getStockAll(rmId);
            return ApiResponse.sendSuccess(c, result);
        } catch (error: any) {
            return ApiResponse.sendError(c, error.statusCode || 500, error.message);
        }
    }
}
