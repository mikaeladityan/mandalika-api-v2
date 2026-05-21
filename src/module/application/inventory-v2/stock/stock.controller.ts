import { Context } from "hono";
import {
    QueryStockDTO,
    QueryStockSchema,
    RequestUpsertStockDTO,
} from "./stock.schema.js";
import { StockService } from "./stock.service.js";
import { ApiResponse } from "../../../../lib/api.response.js";
import { ApiError } from "../../../../lib/errors/api.error.js";

function parseListQuery(c: Context): QueryStockDTO {
    const parsed = QueryStockSchema.safeParse(c.req.query());
    if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? "Parameter query tidak valid";
        throw new ApiError(400, message);
    }
    return parsed.data;
}

export class StockController {
    static async listProductStock(c: Context) {
        const params = parseListQuery(c);

        const {
            data,
            len,
            month: pickedMonth,
            year: pickedYear,
        } = await StockService.listProductStock(params);

        return ApiResponse.sendSuccess(c, { data, len }, 200, {
            ...params,
            month: pickedMonth,
            year: pickedYear,
        });
    }

    static async listWarehouses(c: Context) {
        const result = await StockService.listWarehouses();
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async listProducts(c: Context) {
        const result = await StockService.listProducts();
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async upsertStock(c: Context) {
        const body = c.get("body") as RequestUpsertStockDTO;
        const result = await StockService.upsertStock(body);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async exportStock(c: Context) {
        const params = parseListQuery(c);

        const warehouseName = params.warehouse_id
            ? (await StockService.listWarehouses()).find((w) => w.id === params.warehouse_id)
                  ?.name ?? "Gudang"
            : "Semua-Gudang";

        const buffer = await StockService.exportStock(params);
        const filename = `Stok_${warehouseName.replace(/\s+/g, "_")}_${params.month ?? ""}_${params.year ?? ""}.csv`;

        return new Response(buffer, {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    }
}
