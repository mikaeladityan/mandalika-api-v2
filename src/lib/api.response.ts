import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiResponse {
    static sendSuccess<T>(c: Context, data: T, statusCode: ContentfulStatusCode = 200, q?: any) {
        return c.json(
            {
                query: q,
                status: "success",
                data,
            },
            statusCode,
        );
    }

    static sendError(
        c: Context,
        statusCode: number = 500,
        message: string = "Internal Server Error",
    ) {
        return c.json(
            {
                status: "error",
                message,
            },
            statusCode as any,
        );
    }
}
