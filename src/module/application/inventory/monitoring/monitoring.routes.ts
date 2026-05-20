import { Hono } from "hono";
import StockDistributionRoutes from "./stock-distribution/stock-distribution.routes.js";
import StockMovementRoutes     from "./stock-movement/stock-movement.routes.js";
import StockLocationRoutes     from "./stock-location/stock-location.routes.js";
import StockDiscrepancyRoutes  from "./stock-discrepancy/stock-discrepancy.routes.js";

export const MonitoringRoutes = new Hono();

MonitoringRoutes.route("/stock-distribution", StockDistributionRoutes);
MonitoringRoutes.route("/stock-movement",     StockMovementRoutes);
MonitoringRoutes.route("/stock-location",     StockLocationRoutes);
MonitoringRoutes.route("/stock-discrepancy",  StockDiscrepancyRoutes);

export default MonitoringRoutes;
