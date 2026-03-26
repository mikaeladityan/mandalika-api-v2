import { Context } from "hono";
import { QueryPurchaseSchema } from "./purchase.schema.js";
import { PurchaseService } from "./purchase.service.js";
import { ApiResponse } from "../../../lib/api.response.js";

export class PurchaseController {
    static async list(c: Context) {
        const query = c.req.query();
        const validQuery = QueryPurchaseSchema.parse(query);
        const result = await PurchaseService.list(validQuery);
        return ApiResponse.sendSuccess(c, result);
    }

    static async summary(c: Context) {
        const query = c.req.query();
        const validQuery = QueryPurchaseSchema.parse(query);
        const result = await PurchaseService.summaryBySupplier(validQuery);
        return ApiResponse.sendSuccess(c, result);
    }

    static async export(c: Context) {
        const query = c.req.query();
        const validQuery = QueryPurchaseSchema.parse(query);

        const buffer = await PurchaseService.export(validQuery);

        const month = validQuery.month || new Date().getMonth() + 1;
        const year = validQuery.year || new Date().getFullYear();

        c.header(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        c.header(
            "Content-Disposition",
            `attachment; filename=Pengajuan_Purchase_${month}_${year}.xlsx`,
        );

        return c.body(buffer as any);
    }
}
