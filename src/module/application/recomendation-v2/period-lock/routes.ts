import { Hono } from "hono";
import { validateBody } from "../../../../middleware/validation.js";
import { RecommendationPeriodLockController } from "./controller.js";
import { LockPeriodRequestSchema, UnlockPeriodRequestSchema } from "./schema.js";

const routes = new Hono();
routes.post("/lock", validateBody(LockPeriodRequestSchema), RecommendationPeriodLockController.lock);
routes.post("/unlock", validateBody(UnlockPeriodRequestSchema), RecommendationPeriodLockController.unlock);
routes.get("/locks", RecommendationPeriodLockController.history);

export default routes;
