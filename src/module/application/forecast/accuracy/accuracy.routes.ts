import { Hono } from "hono";
import { ForecastAccuracyController } from "./accuracy.controller.js";

export const ForecastAccuracyRoutes = new Hono();

ForecastAccuracyRoutes.get("/", ForecastAccuracyController.list);
ForecastAccuracyRoutes.get("/trend", ForecastAccuracyController.trend);
ForecastAccuracyRoutes.get("/edar-vs-act", ForecastAccuracyController.edarVsAct);
