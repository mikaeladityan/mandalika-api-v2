import { Hono } from "hono";
import GRRoutes from "./gr/gr.routes.js";
import DORoutes from "./do/do.routes.js";

export const InventoryV2Routes = new Hono();

InventoryV2Routes.route("/gr", GRRoutes);
InventoryV2Routes.route("/do", DORoutes);

export default InventoryV2Routes;
