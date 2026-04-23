import { Hono } from "hono";
import RFQRoutes from "./rfq/rfq.routes.js";

const PurchaseRoutes = new Hono();

PurchaseRoutes.route("/rfq", RFQRoutes);

export default PurchaseRoutes;
