import { Hono } from "hono";
import { validate, validateBody } from "../../../../middleware/validation.js";
import {
    QueryForecastPercentageHistorySchema,
    RequestForecastPercentageBulkSchema,
    RequestForecastPercentageDeleteBulkSchema,
    RequestForecastPercentageSchema,
    RequestForecastPercentageUpdateSchema,
} from "./percentages.schema.js";
import { ForecastPercentageController } from "./percentages.controller.js";

export const ForecastPercentageRoutes = new Hono();

ForecastPercentageRoutes.delete(
    "/bulk",
    validateBody(RequestForecastPercentageDeleteBulkSchema),
    ForecastPercentageController.destroyMany,
);
ForecastPercentageRoutes.post(
    "/bulk",
    validateBody(RequestForecastPercentageBulkSchema),
    ForecastPercentageController.createMany,
);

ForecastPercentageRoutes.get(
    "/history",
    validate(QueryForecastPercentageHistorySchema),
    ForecastPercentageController.listHistoryGlobal,
);
ForecastPercentageRoutes.get(
    "/:id/history",
    ForecastPercentageController.listHistory,
);

ForecastPercentageRoutes.get("/:id", ForecastPercentageController.detail);
ForecastPercentageRoutes.put(
    "/:id",
    validateBody(RequestForecastPercentageUpdateSchema),
    ForecastPercentageController.update,
);
ForecastPercentageRoutes.delete("/:id", ForecastPercentageController.destroy);

ForecastPercentageRoutes.get("/", ForecastPercentageController.list);
ForecastPercentageRoutes.post(
    "/",
    validateBody(RequestForecastPercentageSchema),
    ForecastPercentageController.create,
);
