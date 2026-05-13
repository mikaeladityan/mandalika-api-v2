import { Context } from "hono";
import { FinanceKpiService } from "./kpi.service.js";
import { ApiResponse } from "../../../../lib/api.response.js";

export class FinanceKpiController {
    static async getSummary(c: Context) {
        const result = await FinanceKpiService.getSummary();
        return ApiResponse.sendSuccess(c, result);
    }
}
