import { Hono } from "hono";
import StockTotalRoutes   from "./stock-total/stock-total.routes.js";
import StockCardRoutes    from "./stock-card/stock-card.routes.js";
import StockLocationRoutes from "./stock-location/stock-location.routes.js";

const MonitoringRoutes = new Hono();

MonitoringRoutes.route("/stock-total",    StockTotalRoutes);
MonitoringRoutes.route("/stock-card",     StockCardRoutes);
MonitoringRoutes.route("/stock-location", StockLocationRoutes);

export default MonitoringRoutes;
