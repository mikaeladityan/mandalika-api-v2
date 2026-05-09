import { Context } from "hono";
import { OutletGlobalService } from "./service.js";
import { ApiResponse } from "../../../lib/api.response.js";
import { QueryOutletSchema } from "../../application/outlet/outlet.schema.js";

export class OutletGlobalController {
    static async list(c: Context) {
        const query = QueryOutletSchema.parse(c.req.query());
        const result = await OutletGlobalService.list(query);
        return ApiResponse.sendSuccess(c, result.data, 200, {
            total: result.len,
            page: query.page || 1,
            take: query.take || 25,
        });
    }
}
