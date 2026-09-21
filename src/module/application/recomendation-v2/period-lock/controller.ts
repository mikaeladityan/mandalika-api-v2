import type { Context } from "hono";
import { ApiResponse } from "../../../../lib/api.response.js";
import { LockPeriodRequestSchema, ListLocksQuerySchema, UnlockPeriodRequestSchema } from "./schema.js";
import { RecommendationPeriodLockService } from "./services.js";

export class RecommendationPeriodLockController {
    static async lock(c: Context) {
        const body = LockPeriodRequestSchema.parse(await c.req.json());
        const actorId = c.get("userId") || c.get("user")?.id || "anonymous";
        return ApiResponse.sendSuccess(c, await RecommendationPeriodLockService.createLock(body, String(actorId)), 200);
    }

    static async unlock(c: Context) {
        const body = UnlockPeriodRequestSchema.parse(await c.req.json());
        const actorId = c.get("userId") || c.get("user")?.id || "anonymous";
        return ApiResponse.sendSuccess(c, await RecommendationPeriodLockService.releaseLock(body, String(actorId)), 200);
    }

    static async history(c: Context) {
        const query = ListLocksQuerySchema.parse(c.req.query());
        return ApiResponse.sendSuccess(c, await RecommendationPeriodLockService.listLocks(query), 200);
    }
}
