import { Hono } from "hono";
import { FGRoutes } from "./fg/fg.routes.js";
import { RMRoutes } from "./rm/rm.routes.js";
import { MonitoringRoutes } from "./monitoring/monitoring.routes.js";

export const InventoryRoutes = new Hono();

InventoryRoutes.route("/fg",         FGRoutes);
InventoryRoutes.route("/rm",         RMRoutes);
InventoryRoutes.route("/monitoring", MonitoringRoutes);
