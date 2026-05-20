import { Hono } from "hono";
import FGRoutes from "./fg/fg.routes.js";
import RMRoutes from "./rm/rm.routes.js";

const StockLocationRoutes = new Hono();

StockLocationRoutes.route("/fg", FGRoutes);
StockLocationRoutes.route("/rm", RMRoutes);

export default StockLocationRoutes;
