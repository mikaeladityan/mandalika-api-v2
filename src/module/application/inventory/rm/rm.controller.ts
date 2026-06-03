import { Context } from "hono";
import { ZodError } from "zod";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { Cache } from "../../../../lib/utils/cache.js";
import { CreateLogger, CreateLoggingActivityDTO } from "../../shared/activity-logger.js";
import { RMService } from "./rm.service.js";
import {
    BulkStatusRMDTO,
    IdParamSchema,
    QueryRMDTO,
    QueryRMSchema,
    RequestRMDTO,
} from "./rm.schema.js";

// Hono Context.get default ke `any` tanpa generic Variables — di-narrow di sini supaya type-safe.
type AccountSession = { email: string };

const RM_CACHE_PATTERN = "rm:*";
const TABLE = "Raw Material";

function parseId(c: Context): number {
    try {
        return IdParamSchema.parse({ id: c.req.param("id") }).id;
    } catch (e) {
        if (e instanceof ZodError) throw new ApiError(400, "ID raw material tidak valid");
        throw e;
    }
}

export class RMController {
    static async create(c: Context) {
        const body = c.get("body") as RequestRMDTO;
        const session = c.get("session") as AccountSession;

        const result = await Cache.afterMutation(() => RMService.create(body), RM_CACHE_PATTERN);

        const log: CreateLoggingActivityDTO = {
            activity: "CREATE",
            description: `${TABLE}: ${result.name}`,
            email: session.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async update(c: Context) {
        const id = parseId(c);
        const body = c.get("body") as Partial<RequestRMDTO>;
        const session = c.get("session") as AccountSession;

        const result = await Cache.afterMutation(
            () => RMService.update(id, body),
            RM_CACHE_PATTERN,
        );

        const log: CreateLoggingActivityDTO = {
            activity: "UPDATE",
            description: `${TABLE} #${id}: ${result.name}`,
            email: session.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async detail(c: Context) {
        const id = parseId(c);
        const result = await RMService.detail(id);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async list(c: Context) {
        const params: QueryRMDTO = QueryRMSchema.parse(c.req.query());
        const result = await RMService.list(params);
        return ApiResponse.sendSuccess(c, result, 200, params);
    }

    static async delete(c: Context) {
        const id = parseId(c);
        const session = c.get("session") as AccountSession;

        await Cache.afterMutation(() => RMService.delete(id), RM_CACHE_PATTERN);

        const log: CreateLoggingActivityDTO = {
            activity: "DELETE",
            description: `${TABLE} #${id}`,
            email: session.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, {}, 200);
    }

    static async restore(c: Context) {
        const id = parseId(c);
        const session = c.get("session") as AccountSession;

        await Cache.afterMutation(() => RMService.restore(id), RM_CACHE_PATTERN);

        const log: CreateLoggingActivityDTO = {
            activity: "UPDATE",
            description: `Restore ${TABLE} #${id}`,
            email: session.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, {}, 200);
    }

    static async clean(c: Context) {
        const session = c.get("session") as AccountSession;

        const result = await Cache.afterMutation(() => RMService.clean(), RM_CACHE_PATTERN);

        const log: CreateLoggingActivityDTO = {
            activity: "CLEAN",
            description: TABLE,
            email: session.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async bulkStatus(c: Context) {
        const body = c.get("body") as BulkStatusRMDTO;
        const session = c.get("session") as AccountSession;

        const result = await Cache.afterMutation(
            () => RMService.bulkStatus(body.ids, body.status),
            RM_CACHE_PATTERN,
        );

        const log: CreateLoggingActivityDTO = {
            activity: body.status === "DELETE" ? "DELETE" : "UPDATE",
            description: `Bulk ${body.status} ${TABLE} for ${body.ids.length} items`,
            email: session.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async export(c: Context) {
        const params: QueryRMDTO = QueryRMSchema.parse(c.req.query());
        const buffer = await RMService.export(params);

        c.header("Content-Type", "text/csv");
        c.header("Content-Disposition", `attachment; filename="data-raw-materials.csv"`);
        return c.body(buffer);
    }
}
