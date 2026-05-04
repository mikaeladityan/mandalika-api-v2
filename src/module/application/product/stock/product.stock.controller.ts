import { Context } from "hono";
import { QueryProductStockDTO } from "./product.stock.schema.js";
import { ProductStockService } from "./product.stock.service.js";
import { ApiResponse } from "../../../../lib/api.response.js";

export class ProductStockController {
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
        const params: QueryProductStockDTO = {
            page: page ? Number(page) : undefined,
            search,
            sortBy: sortBy as QueryProductStockDTO["sortBy"],
            sortOrder: sortOrder as QueryProductStockDTO["sortOrder"],
            take: take ? Number(take) : undefined,
            type_id: type_id ? Number(type_id) : undefined,
            gender: gender as QueryProductStockDTO["gender"],
            warehouse_id: warehouse_id ? Number(warehouse_id) : undefined,
            month: month ? Number(month) : undefined,
            year: year ? Number(year) : undefined,
        };

        const {
            data,
            len,
            month: pickedMonth,
            year: pickedYear,
        } = await ProductStockService.listProductStock(params);

        return ApiResponse.sendSuccess(c, { data, len }, 200, {
            ...params,
            month: pickedMonth,
            year: pickedYear,
        });
    }

    static async listWarehouses(c: Context) {
        const result = await ProductStockService.listWarehouses();
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async listProducts(c: Context) {
        const result = await ProductStockService.listProducts();
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async upsertStock(c: Context) {
        const body = await c.req.json();
        const result = await ProductStockService.upsertStock(body);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async exportStock(c: Context) {
        const { gender, search, type_id, warehouse_id, month, year } = c.req.query();

        const params: QueryProductStockDTO = {
            search,
            gender: gender as QueryProductStockDTO["gender"],
            type_id: type_id ? Number(type_id) : undefined,
            warehouse_id: warehouse_id ? Number(warehouse_id) : undefined,
            month: month ? Number(month) : undefined,
            year: year ? Number(year) : undefined,
        };

        const warehouseName = warehouse_id
            ? (await ProductStockService.listWarehouses()).find((w) => w.id === Number(warehouse_id))?.name ?? "Gudang"
            : "Semua-Gudang";

        const buffer = await ProductStockService.exportStock(params);
        const filename = `Stok_${warehouseName.replace(/\s+/g, "_")}_${month ?? ""}_${year ?? ""}.csv`;

        c.header("Content-Type", "text/csv");
        c.header("Content-Disposition", `attachment; filename="${filename}"`);
        return c.body(buffer as any);
    }
}
