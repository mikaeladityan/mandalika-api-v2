import { Hono } from "hono";
import { ApiResponse } from "../../../../lib/api.response.js";
import { DiscontinueAnchorKeySchema, SaveDiscontinueAnchorSchema } from "./discontinue.schema.js";
import { DiscontinueService } from "./discontinue.service.js";
import { DiscontinueLossService } from "./discontinue-loss.service.js";
import { DiscontinueLossKeySchema } from "./discontinue-loss.schema.js";

const routes = new Hono();
routes.get("/loss", async (c) => {
    const key = DiscontinueLossKeySchema.parse(c.req.query());
    return ApiResponse.sendSuccess(c, await DiscontinueLossService.check(key), 200);
});
routes.put("/anchor", async (c) => {
    const body = SaveDiscontinueAnchorSchema.parse(await c.req.json());
    return ApiResponse.sendSuccess(c, await DiscontinueService.save(body), 200);
});
routes.delete("/anchor", async (c) => {
    const key = DiscontinueAnchorKeySchema.parse(await c.req.json());
    return ApiResponse.sendSuccess(c, await DiscontinueService.reset(key), 200);
});
export default routes;
