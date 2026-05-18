import { Context } from "hono";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { CreateLogger, CreateLoggingActivityDTO } from "../../shared/activity-logger.js";
import { FGService } from "./fg.service.js";
import {
    BulkStatusFGDTO,
    QueryFGDTO,
    QueryFGSchema,
    RequestFGDTO,
    StatusParamFGSchema,
} from "./fg.schema.js";

// Hono Context.get default ke `any` tanpa generic Variables — di-narrow di sini supaya type-safe.
type AccountSession = { email: string };

export class FGController {
    static async create(c: Context) {
        const body = c.get("body") as RequestFGDTO;
        const session = c.get("session") as AccountSession;

        const result = await FGService.create(body);

        const log: CreateLoggingActivityDTO = {
            activity: "CREATE",
            description: `FG ${result.code}: ${result.name}`,
            email: session.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async update(c: Context) {
        const id = c.req.param("id");
        if (!id) throw new ApiError(400, "Kesalahan pada proses permintaan data");

        const body = c.get("body") as Partial<RequestFGDTO>;
        const session = c.get("session") as AccountSession;

        const result = await FGService.update(Number(id), body);

        const log: CreateLoggingActivityDTO = {
            activity: "UPDATE",
            description: `FG ${result.code}: ${result.name}`,
            email: session.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async status(c: Context) {
        const id = c.req.param("id");
        if (!id) throw new ApiError(400, "Kesalahan pada proses permintaan data");

        const parsed = StatusParamFGSchema.safeParse({ status: c.req.query("status") });
        if (!parsed.success) throw new ApiError(400, "Status tidak valid");

        await FGService.status(Number(id), parsed.data.status);

        const session = c.get("session") as AccountSession;
        const log: CreateLoggingActivityDTO = {
            activity: "UPDATE",
            description: `Status FG ${id}`,
            email: session.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, {}, 200);
    }

    static async bulkStatus(c: Context) {
        const body = c.get("body") as BulkStatusFGDTO;

        await FGService.bulkStatus(body.ids, body.status);

        const session = c.get("session") as AccountSession;
        const log: CreateLoggingActivityDTO = {
            activity: "UPDATE",
            description: `Bulk Status FG (${body.ids.length} items)`,
            email: session.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, {}, 200);
    }

    static async export(c: Context) {
        const params: QueryFGDTO = QueryFGSchema.parse(c.req.query());
        const buffer = await FGService.export(params);

        c.header("Content-Type", "text/csv; charset=utf-8");
        c.header("Content-Disposition", `attachment; filename="fg-export-${Date.now()}.csv"`);
        return c.body(buffer);
    }

    static async clean(c: Context) {
        await FGService.clean();

        const session = c.get("session") as AccountSession;
        const log: CreateLoggingActivityDTO = {
            activity: "CLEAN",
            description: "FG",
            email: session.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, {}, 200);
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
}
