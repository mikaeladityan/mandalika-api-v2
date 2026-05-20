import { Hono } from "hono";
import { StockMovementController } from "./stock-movement.controller.js";

const StockMovementRoutes = new Hono();

// NOTE: /export must be registered BEFORE /:id style routes to avoid route conflict
StockMovementRoutes.get("/export", StockMovementController.export);
StockMovementRoutes.get("/",       StockMovementController.list);

export default StockMovementRoutes;
