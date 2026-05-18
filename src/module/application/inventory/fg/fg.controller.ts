import { Context } from "hono";
import { CreateLogger, CreateLoggingActivityDTO } from "../../shared/activity-logger.js";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { Cache } from "../../../../lib/utils/cache.js";
import { redisClient } from "../../../../config/redis.js";
import { FGService } from "./fg.service.js";
import {
    BulkStatusFGDTO,
    FGLookupSchema,
    QueryFGDTO,
    QueryFGSchema,
    RequestFGDTO,
    StatusParamFGSchema,
} from "./fg.schema.js";

// reason: Hono Context.get default ke `any` tanpa generic Variables — di-narrow di sini supaya type-safe sampai global Variables didefinisikan.
type AccountSession = { email: string };

const FG_CACHE_PATTERN = "fg:*";
const FG_LOOKUP_KEY = "fg:lookup";
const FG_LOOKUP_TTL = 3600; // 1 jam — FG jarang berubah, lookup cache bisa bertahan lama.

export class FGController {
    static async create(c: Context) {
        const body = c.get("body") as RequestFGDTO; // reason: divalidasi oleh validateBody(RequestFGSchema)
        const accountSession = c.get("session") as AccountSession; // reason: di-set oleh authMiddleware

        const result = await Cache.afterMutation(
            () => FGService.create(body),
            FG_CACHE_PATTERN,
        );

        if (result) {
            const log: CreateLoggingActivityDTO = {
                activity: "CREATE",
                description: `FG ${result.code}: ${result.name}`,
                email: accountSession.email,
            };
            await CreateLogger(log);
        }

        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async update(c: Context) {
        const id = c.req.param("id");
        if (!id) throw new ApiError(400, "Kesalahan pada proses permintaan data");

        const body = c.get("body") as Partial<RequestFGDTO>; // reason: divalidasi oleh validateBody(RequestFGSchema.partial())
        const accountSession = c.get("session") as AccountSession;

        const result = await Cache.afterMutation(
            () => FGService.update(Number(id), body),
            FG_CACHE_PATTERN,
        );

        if (result) {
            const log: CreateLoggingActivityDTO = {
                activity: "UPDATE",
                description: `FG ${result.code}: ${result.name}`,
                email: accountSession.email,
            };
            await CreateLogger(log);
        }

        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async status(c: Context) {
        const id = c.req.param("id");
        if (!id) throw new ApiError(400, "Kesalahan pada proses permintaan data");

        const parsed = StatusParamFGSchema.safeParse({ status: c.req.query("status") });
        if (!parsed.success) throw new ApiError(400, "Status tidak valid");

        await Cache.afterMutation(
            () => FGService.status(Number(id), parsed.data.status),
            FG_CACHE_PATTERN,
        );

        const accountSession = c.get("session") as AccountSession;
        const log: CreateLoggingActivityDTO = {
            activity: "UPDATE",
            description: `Status FG ${id}`,
            email: accountSession.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, {}, 201);
    }

    static async bulkStatus(c: Context) {
        const body = c.get("body") as BulkStatusFGDTO; // reason: divalidasi oleh validateBody(BulkStatusFGSchema)

        await Cache.afterMutation(
            () => FGService.bulkStatus(body.ids, body.status),
            FG_CACHE_PATTERN,
        );

        const accountSession = c.get("session") as AccountSession;
        const log: CreateLoggingActivityDTO = {
            activity: "UPDATE",
            description: `Bulk Status FG (${body.ids.length} items)`,
            email: accountSession.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, {}, 200);
    }

    static async export(c: Context) {
        const params: QueryFGDTO = QueryFGSchema.parse(c.req.query());
        const buffer = await FGService.export(params);

        c.header("Content-Type", "text/csv");
        c.header("Content-Disposition", `attachment; filename="data-produk.csv"`);
        return c.body(buffer);
    }

    static async clean(c: Context) {
        await Cache.afterMutation(() => FGService.clean(), FG_CACHE_PATTERN);

        const accountSession = c.get("session") as AccountSession;
        const log: CreateLoggingActivityDTO = {
            activity: "CLEAN",
            description: `FG`,
            email: accountSession.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, {}, 201);
    }

    static async list(c: Context) {
        const params: QueryFGDTO = QueryFGSchema.parse(c.req.query());
        const result = await FGService.list(params);
        return ApiResponse.sendSuccess(c, result, 200, params);
    }

    static async detail(c: Context) {
        const id = c.req.param("id");
        if (!id) throw new ApiError(400, "Kesalahan pada proses permintaan data");

        const result = await FGService.detail(Number(id));
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async lookup(c: Context) {
        const cached = await redisClient.get(FG_LOOKUP_KEY);
        if (cached) {
            // reason: cache payload diparse dengan Zod supaya tetap type-safe (bukan cast `as`).
            const parsed = FGLookupSchema.safeParse(JSON.parse(cached));
            if (parsed.success) return ApiResponse.sendSuccess(c, parsed.data, 200);
            // Schema drift — invalidate dan fall-through ke DB.
            await redisClient.del(FG_LOOKUP_KEY);
        }

        const result = await FGService.lookup();
        await redisClient.set(FG_LOOKUP_KEY, JSON.stringify(result), "EX", FG_LOOKUP_TTL);
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
