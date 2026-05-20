import { Hono } from "hono";
import FGRoutes from "./fg/fg.routes.js";
import RMRoutes from "./rm/rm.routes.js";

const StockMovementRoutes = new Hono();

StockMovementRoutes.route("/fg", FGRoutes);
StockMovementRoutes.route("/rm", RMRoutes);

export default StockMovementRoutes;
