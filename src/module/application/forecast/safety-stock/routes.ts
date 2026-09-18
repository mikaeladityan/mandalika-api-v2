import { Hono } from "hono";
import { validate } from "../../../../middleware/validation.js";
import { SafetyStockController } from "./controller.js";
import { QuerySafetyStockSchema, QuerySafetyStockSummarySchema } from "./schema.js";

export const SafetyStockRoutes = new Hono();
SafetyStockRoutes.get("/summary", validate(QuerySafetyStockSummarySchema), SafetyStockController.summary);
SafetyStockRoutes.get("/", validate(QuerySafetyStockSchema), SafetyStockController.list);
