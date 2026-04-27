import { Context } from "hono";
import { ReturnService } from "./return.service.js";
import { ApiResponse } from "../../../../lib/api.response.js";
import { CreateLogger } from "../../shared/activity-logger.js";
import {
    QueryReturnSchema,
    RequestReturnDTO,
    UpdateReturnStatusDTO,
    RequestUpdateReturnSchema,
    RequestUpdateReturnDTO,
} from "./return.schema.js";

export class ReturnController {
    static async list(c: Context) {
        const query = c.req.query();
        const validated = QueryReturnSchema.parse(query);
        const result = await ReturnService.list(validated);
        return ApiResponse.sendSuccess(c, result, 200, validated);
    }

    static async export(c: Context) {
        const query = c.req.query();
        const validated = QueryReturnSchema.parse(query);
        const csv = await ReturnService.export(validated);

        c.header("Content-Type", "text/csv; charset=utf-8");
        c.header("Content-Disposition", `attachment; filename="Return_Export_${Date.now()}.csv"`);

        return c.text(csv as any);
    }

    static async detail(c: Context) {
        try {
            const id = Number(c.req.param("id"));
            const result = await ReturnService.detail(id);
            return ApiResponse.sendSuccess(c, result);
        } catch (error: any) {
            return ApiResponse.sendError(c, error.statusCode || 500, error.message);
        }
    }

    static async create(c: Context) {
        try {
            const body = c.get("body") as RequestReturnDTO;
            const accountSession = c.get("session");
            const userId = accountSession?.email || "system";

            const result = await ReturnService.create(body, userId);

            if (result) {
                const log: any = {
                    activity: "CREATE",
                    description: `Retur ${result.return_number} dibuat (Asal: ${result.from_warehouse?.name || result.from_outlet?.name} -> Gudang: ${result.to_warehouse?.name})`,
                    email: userId,
                };
                await CreateLogger(log);
            }

            return ApiResponse.sendSuccess(c, result, 201);
        } catch (error: any) {
            return ApiResponse.sendError(c, error.statusCode || 500, error.message);
        }
    }

    static async updateStatus(c: Context) {
        try {
            const id = Number(c.req.param("id"));
            const body = c.get("body") as UpdateReturnStatusDTO;
            const accountSession = c.get("session");
            const userId = accountSession?.email || "system";

            const result = await ReturnService.updateStatus(id, body, userId);

            if (result) {
                const log: any = {
                    activity: "UPDATE",
                    description: `Retur ${result.return_number} status diperbarui menjadi ${result.status}`,
                    email: userId,
                };
                await CreateLogger(log);
            }

            return ApiResponse.sendSuccess(c, result);
        } catch (error: any) {
            return ApiResponse.sendError(c, error.statusCode || 500, error.message);
        }
    }

    static async update(c: Context) {
        try {
            const id = Number(c.req.param("id"));
            const body = c.get("body") as RequestUpdateReturnDTO;
            const accountSession = c.get("session");
            const userId = accountSession?.email || "system";

            const result = await ReturnService.update(id, body, userId);

            if (result) {
                const log: any = {
                    activity: "UPDATE",
                    description: `Retur ${result.return_number} diperbarui datanya`,
                    email: userId,
                };
                await CreateLogger(log);
            }

            return ApiResponse.sendSuccess(c, result);
        } catch (error: any) {
            return ApiResponse.sendError(c, error.statusCode || 500, error.message);
        }
    }
}
