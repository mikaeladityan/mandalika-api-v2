import { Hono } from "hono";
import RFQRoutes from "./rfq/rfq.routes.js";
import PORoutes from "./po/po.routes.js";

const PurchaseRoutes = new Hono();

PurchaseRoutes.route("/rfq", RFQRoutes);
PurchaseRoutes.route("/po", PORoutes);

export default PurchaseRoutes;
