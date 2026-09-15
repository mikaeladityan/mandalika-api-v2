import { Hono } from "hono";
import { StockResilienceController } from "./stock-resilience.controller.js";

export const StockResilienceRoutes = new Hono();
StockResilienceRoutes.get("/", StockResilienceController.list);

