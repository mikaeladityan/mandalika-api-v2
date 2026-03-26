import { Context } from "hono";
import { SalesService } from "./sales.service.js";
import { ApiResponse } from "../../../lib/api.response.js";
import { QuerySalesDTO, QuerySalesRekapDTO } from "./sales.schema.js";

export class SalesController {
    static async create(c: Context) {
        const body = c.get("body");
        await SalesService.create(body);
        return ApiResponse.sendSuccess(c, undefined, 201);
    }

    static async update(c: Context) {
        const body = c.get("body");
        await SalesService.update(body);
        return ApiResponse.sendSuccess(c, undefined, 200);
    }

    static async list(c: Context) {
        const {
            product_id,
            product_id_2,
            sortBy,
            sortOrder,
            gender,
            horizon,
            size,
            variant,
            search,
            page,
            take,
            type,
        } = c.req.query();

        const params: QuerySalesDTO = {
            sortBy: (sortBy as QuerySalesDTO["sortBy"]) || "name",
            sortOrder: (sortOrder as QuerySalesDTO["sortOrder"]) || "desc",
            gender: (gender as QuerySalesDTO["gender"]) || undefined,
            variant: variant || undefined,
            size: size ? Number(size) : undefined,
            horizon: horizon ? Number(horizon) : undefined,
            product_id: product_id ? Number(product_id) : undefined,
            product_id_2: product_id_2 ? Number(product_id_2) : undefined,
            search: search || undefined,
            page: page ? Number(page) : 1,
            take: take ? Number(take) : 10,
            type: (type as QuerySalesDTO["type"]) || undefined,
        };

        const result = await SalesService.list(params);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async detail(c: Context) {
        const product_id = c.req.param("product_id");
        const { year, month, type } = c.req.query();
        const data = await SalesService.detail(
            Number(product_id),
            Number(year),
            Number(month),
            type as any,
        );
        return ApiResponse.sendSuccess(c, data, 200);
    }

    static async rekap(c: Context) {
        const {
            year,
            month,
            search,
            gender,
            size,
            variant,
            page,
            take,
            sortBy,
            sortOrder,
        } = c.req.query();

        const params: QuerySalesRekapDTO = {
            year: year ? Number(year) : undefined,
            month: month ? Number(month) : undefined,
            search: search || undefined,
            gender: (gender as QuerySalesRekapDTO["gender"]) || undefined,
            size: size ? Number(size) : undefined,
            variant: variant || undefined,
            page: page ? Number(page) : 1,
            take: take ? Number(take) : 25,
            sortBy: (sortBy as QuerySalesRekapDTO["sortBy"]) || "name",
            sortOrder: (sortOrder as QuerySalesRekapDTO["sortOrder"]) || "asc",
        };

        const result = await SalesService.rekap(params);
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
