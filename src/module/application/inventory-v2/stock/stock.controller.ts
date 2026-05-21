import { Context } from "hono";
import { QueryStockDTO } from "./stock.schema.js";
import { StockService } from "./stock.service.js";
import { ApiResponse } from "../../../../lib/api.response.js";

export class StockController {
    static async listProductStock(c: Context) {
        const {
            page,
            take,
            gender,
            search,
            sortBy,
            sortOrder,
            type_id,
            warehouse_id,
            month,
            year,
        } = c.req.query();
        const params: QueryStockDTO = {
            page: page ? Number(page) : undefined,
            search,
            sortBy: sortBy as QueryStockDTO["sortBy"],
            sortOrder: sortOrder as QueryStockDTO["sortOrder"],
            take: take ? Number(take) : undefined,
            type_id: type_id ? Number(type_id) : undefined,
            gender: gender as QueryStockDTO["gender"],
            warehouse_id: warehouse_id ? Number(warehouse_id) : undefined,
            month: month ? Number(month) : undefined,
            year: year ? Number(year) : undefined,
        };

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
        const body = await c.req.json();
        const result = await StockService.upsertStock(body);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async exportStock(c: Context) {
        const { gender, search, type_id, warehouse_id, month, year } = c.req.query();

        const params: QueryStockDTO = {
            search,
            gender: gender as QueryStockDTO["gender"],
            type_id: type_id ? Number(type_id) : undefined,
            warehouse_id: warehouse_id ? Number(warehouse_id) : undefined,
            month: month ? Number(month) : undefined,
            year: year ? Number(year) : undefined,
        };

        const warehouseName = warehouse_id
            ? (await StockService.listWarehouses()).find((w) => w.id === Number(warehouse_id))?.name ?? "Gudang"
            : "Semua-Gudang";

        const buffer = await StockService.exportStock(params);
        const filename = `Stok_${warehouseName.replace(/\s+/g, "_")}_${month ?? ""}_${year ?? ""}.csv`;

        c.header("Content-Type", "text/csv");
        c.header("Content-Disposition", `attachment; filename="${filename}"`);
        return c.body(buffer as any);
    }
}
