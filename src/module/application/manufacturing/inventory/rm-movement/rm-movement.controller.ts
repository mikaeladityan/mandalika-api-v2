import { Context } from "hono";
import { RmMovmentService } from "./rm-movement.service.js";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { QueryRmMovmentSchema } from "./rm-movement.schema.js";

export class RmMovmentController {
    static async list(c: Context) {
        const query = QueryRmMovmentSchema.parse(c.req.query());
        const result = await RmMovmentService.getMovements(query);
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
