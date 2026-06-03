import { Context } from "hono";
import { ProductService } from "./product.service.js";
import { ApiResponse } from "../../../lib/api.response.js";
import { ApiError } from "../../../lib/errors/api.error.js";
import { CreateLogger } from "../shared/activity-logger.js";
import { CreateLoggingActivityDTO } from "../shared/activity-logger.js";
import {
    QueryProductDTO,
    QueryProductSchema,
    StatusQuerySchema,
} from "./product.schema.js";
import { Cache } from "../../../lib/utils/cache.js";

const Table = "Produk";
const PRODUCT_LIST_KEY = "products:list";

function parseId(raw: string | undefined): number {
    if (!raw) throw new ApiError(400, "Kesalahan pada proses permintaan data");
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "ID produk tidak valid");
    return id;
}

function parseListQuery(c: Context): QueryProductDTO {
    const parsed = QueryProductSchema.safeParse(c.req.query());
    if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? "Parameter query tidak valid";
        throw new ApiError(400, message);
    }
    return parsed.data;
}

export class ProductController {
    static async create(c: Context) {
        const body = c.get("body");
        const accountSession = c.get("session");

        const result = await ProductService.create(body);

        if (result) {
            const log: CreateLoggingActivityDTO = {
                activity: "CREATE",
                description: `Buat ${Table} ${result.code}: ${result.name}`,
                email: accountSession.email,
            };
            await CreateLogger(log);
        }

        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async update(c: Context) {
        const id = parseId(c.req.param("id"));

        const body = c.get("body");
        const accountSession = c.get("session");

        const result = await ProductService.update(id, body);

        if (result) {
            const log: CreateLoggingActivityDTO = {
                activity: "UPDATE",
                description: `Ubah ${Table} ${result.code}: ${result.name}`,
                email: accountSession.email,
            };
            await CreateLogger(log);
        }

        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async status(c: Context) {
        const id = parseId(c.req.param("id"));

        const parsed = StatusQuerySchema.safeParse(c.req.query());
        if (!parsed.success) throw new ApiError(400, "Status tidak valid");

        await ProductService.status(id, parsed.data.status);

        const accountSession = c.get("session");
        const log: CreateLoggingActivityDTO = {
            activity: "UPDATE",
            description: `Ubah status ${Table} ${id}`,
            email: accountSession.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, {}, 200);
    }

    static async export(c: Context) {
        const params = parseListQuery(c);

        const buffer = await ProductService.export(params);

        return new Response(buffer, {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="data-produk.csv"`,
            },
        });
    }

    static async clean(c: Context) {
        const result = await Cache.afterMutation(
            () => ProductService.clean(),
            PRODUCT_LIST_KEY,
        );

        const accountSession = c.get("session");
        const log: CreateLoggingActivityDTO = {
            activity: "CLEAN",
            description: `Bersihkan ${Table} (${result?.deleted ?? 0} item)`,
            email: accountSession.email,
        };
        await CreateLogger(log);

        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async list(c: Context) {
        const params = parseListQuery(c);

        const result = await ProductService.list(params);

        return ApiResponse.sendSuccess(c, result, 200, params);
    }

    static async detail(c: Context) {
        const id = parseId(c.req.param("id"));

        const result = await ProductService.detail(id);

        return ApiResponse.sendSuccess(c, result, 200);
    }
}
