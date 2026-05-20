import { Hono } from "hono";
import { StockDiscrepancyController } from "./stock-discrepancy.controller.js";

const StockDiscrepancyRoutes = new Hono();

// NOTE: /export must be registered BEFORE /:id style routes to avoid route conflict
StockDiscrepancyRoutes.get("/export", StockDiscrepancyController.export);
StockDiscrepancyRoutes.get("/",       StockDiscrepancyController.list);

export default StockDiscrepancyRoutes;
