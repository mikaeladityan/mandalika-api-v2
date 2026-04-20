import { Context } from "hono";
import { ManufacturingService } from "./manufacturing.service.js";
import { ApiResponse } from "../../../lib/api.response.js";
import {
    QueryProductionSchema,
    RequestQcActionDTO,
    RequestSubmitResultDTO,
    RequestChangeStatusDTO,
    QueryWasteSchema,
    RequestUpdateProductionDTO,
} from "./manufacturing.schema.js";

export class ManufacturingController {
    static async create(c: Context) {
        const body = c.get("body");
        const user = c.get("user");
        const userId = user?.id || "system";
        const result = await ManufacturingService.create(body, userId);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async changeStatus(c: Context) {
        const id = Number(c.req.param("id"));
        const body = c.get("body") as RequestChangeStatusDTO;
        const user = c.get("user");
        const userId = user?.id || "system";
        const result = await ManufacturingService.changeStatus(id, body, userId);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async submitResult(c: Context) {
        const id = Number(c.req.param("id"));
        const body = c.get("body") as RequestSubmitResultDTO;
        const user = c.get("user");
        const userId = user?.id || "system";
        const result = await ManufacturingService.submitResult(id, body, userId);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async qcAction(c: Context) {
        const id = Number(c.req.param("id"));
        const body = c.get("body") as RequestQcActionDTO;
        const user = c.get("user");
        const userId = user?.id || "system";
        const result = await ManufacturingService.qcAction(id, body, userId);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async list(c: Context) {
        const query = c.req.query();
        const queries = c.req.queries();
        
        const normalizedQuery: Record<string, any> = { ...query };

        // Normalize keys ending in [] (from Axios/other clients) and handle multi-value parameters
        Object.keys(queries).forEach((key) => {
            const values = queries[key];
            if (!values) return; // Skip if undefined

            const baseKey = key.endsWith("[]") ? key.slice(0, -2) : key;
            
            if (values.length > 1) {
                normalizedQuery[baseKey] = values;
            } else if (key.endsWith("[]")) {
                // Even if single value, if it came as key[], treat it as potentially part of an array
                normalizedQuery[baseKey] = values[0];
            }
        });

        const validated = QueryProductionSchema.parse(normalizedQuery);
        const result = await ManufacturingService.list(validated);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async detail(c: Context) {
        const id = Number(c.req.param("id"));
        const result = await ManufacturingService.detail(id);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async listWastes(c: Context) {
        const query = c.req.query();
        const validated = QueryWasteSchema.parse(query);
        const result = await ManufacturingService.listWastes(validated);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async delete(c: Context) {
        const id = Number(c.req.param("id"));
        const result = await ManufacturingService.delete(id);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async update(c: Context) {
        const id = Number(c.req.param("id"));
        const body = c.get("body") as RequestUpdateProductionDTO;
        const user = c.get("user");
        const userId = user?.id || "system";
        const result = await ManufacturingService.update(id, body, userId);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async cleanCancelled(c: Context) {
        const result = await ManufacturingService.cleanCancelled();
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
