import { Hono } from "hono";
import FGRoutes from "./fg/fg.routes.js";
import RMRoutes from "./rm/rm.routes.js";

const StockDistributionRoutes = new Hono();

StockDistributionRoutes.route("/fg", FGRoutes);
StockDistributionRoutes.route("/rm", RMRoutes);

export default StockDistributionRoutes;
