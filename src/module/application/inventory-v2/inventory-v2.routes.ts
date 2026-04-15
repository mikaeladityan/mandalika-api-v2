import { Hono } from "hono";
import GRRoutes from "./gr/gr.routes.js";
import DORoutes from "./do/do.routes.js";
import TGRoutes from "./tg/tg.routes.js";
import ReturnRoutes from "./return/return.routes.js";
import MonitoringRoutes from "./monitoring/monitoring.routes.js";

export const InventoryV2Routes = new Hono();

InventoryV2Routes.route("/gr",         GRRoutes);
InventoryV2Routes.route("/do",         DORoutes);
InventoryV2Routes.route("/tg",         TGRoutes);
InventoryV2Routes.route("/return",     ReturnRoutes);
InventoryV2Routes.route("/monitoring", MonitoringRoutes);

export default InventoryV2Routes;
