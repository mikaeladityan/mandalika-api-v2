import type { Context } from "hono";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { QuerySafetyStockSchema, QuerySafetyStockSummarySchema } from "./schema.js";
import { SafetyStockService } from "./services.js";

export class SafetyStockController {
    static async list(c: Context) {
        const query = QuerySafetyStockSchema.parse(c.req.query());
        return ApiResponse.sendSuccess(c, await withDatabaseErrorMessage(() => SafetyStockService.list(query)), 200, query);
    }

    static async summary(c: Context) {
        const query = QuerySafetyStockSummarySchema.parse(c.req.query());
        return ApiResponse.sendSuccess(c, await withDatabaseErrorMessage(() => SafetyStockService.summary(query)), 200, query);
    }
}

async function withDatabaseErrorMessage<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (isPrismaDatabaseUnavailable(error)) {
            throw new ApiError(503, "Database belum dapat dihubungi. Periksa koneksi database lalu coba lagi.");
        }
        throw error;
    }
}

function isPrismaDatabaseUnavailable(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P1001";
}
