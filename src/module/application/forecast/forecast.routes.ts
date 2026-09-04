import { Hono } from "hono";
import { validateBody } from "../../../middleware/validation.js";
import { ForecastPercentageRoutes } from "./percentages/percentages.routes.js";
import { ForecastAccuracyRoutes } from "./accuracy/accuracy.routes.js";
import { ForecastController } from "./forecast.controller.js";
import {
    DeleteForecastByPeriodSchema,
    FinalizeForecastSchema,
    QueryInventoryTurnoverSchema,
    RunForecastSchema,
    UpdateManualForecastSchema,
} from "./forecast.schema.js";

export const ForecastRoutes = new Hono();

ForecastRoutes.route("/forecast-percentages", ForecastPercentageRoutes);
ForecastRoutes.route("/accuracy", ForecastAccuracyRoutes);

// Static routes (must be before /:product_id / /:id)
ForecastRoutes.post("/run", validateBody(RunForecastSchema), ForecastController.run);
ForecastRoutes.patch("/finalize", validateBody(FinalizeForecastSchema), ForecastController.finalize);
ForecastRoutes.delete("/period", validateBody(DeleteForecastByPeriodSchema), ForecastController.deleteByPeriod);
ForecastRoutes.patch("/manual-update", validateBody(UpdateManualForecastSchema), ForecastController.updateManual);
ForecastRoutes.delete("/reset/:product_id", ForecastController.resetByProduct);

ForecastRoutes.get("/compare", ForecastController.compare);
ForecastRoutes.get("/inventory-turnover/export", ForecastController.exportInventoryTurnover);
ForecastRoutes.get("/inventory-turnover", ForecastController.inventoryTurnover);
ForecastRoutes.get("/inventory-turnover-rm/export", ForecastController.exportInventoryTurnoverRM);
ForecastRoutes.get("/inventory-turnover-rm", ForecastController.inventoryTurnoverRM);
ForecastRoutes.get("/export", ForecastController.export);
ForecastRoutes.get("/", ForecastController.list);
ForecastRoutes.post("/", validateBody(RunForecastSchema), ForecastController.run);

// Parameterized routes
ForecastRoutes.get("/:product_id", ForecastController.detail);
ForecastRoutes.delete("/:id", ForecastController.destroyById);
