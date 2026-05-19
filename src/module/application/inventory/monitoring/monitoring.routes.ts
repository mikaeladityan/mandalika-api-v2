import { Hono } from "hono";
import StockDistributionRoutes from "./stock-distribution/stock-distribution.routes.js";

export const MonitoringRoutes = new Hono();

MonitoringRoutes.route("/stock-distribution", StockDistributionRoutes);

export default MonitoringRoutes;
