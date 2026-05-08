import { Context } from "hono";
import { ExchangeRateService } from "./exchange-rate.service.js";
import { QueryExchangeRateSchema } from "./exchange-rate.schema.js";
import { ApiResponse } from "../../../../lib/api.response.js";

export class ExchangeRateController {
    static async getRate(c: Context) {
        const query = QueryExchangeRateSchema.parse(c.req.query());
        const result = await ExchangeRateService.getRate(query);
        return ApiResponse.sendSuccess(c, result);
    }
}
