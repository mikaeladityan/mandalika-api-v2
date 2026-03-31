import { Hono } from "hono";
import GRRoutes from "./gr/gr.routes.js";

export const InventoryV2Routes = new Hono();

InventoryV2Routes.route("/gr", GRRoutes);
