import { Hono } from "hono";
import { OutletGlobalRoutes } from "./outlet/routes.js";

export const GlobalRoutes = new Hono();

GlobalRoutes.route("/outlets", OutletGlobalRoutes);
