import { Hono } from "hono";
import RFQRoutes from "./rfq/rfq.routes.js";
import PORoutes from "./po/po.routes.js";
import ExchangeRateRoutes from "./exchange-rate/exchange-rate.routes.js";

const PurchaseRoutes = new Hono();

PurchaseRoutes.route("/rfq", RFQRoutes);
PurchaseRoutes.route("/po", PORoutes);
PurchaseRoutes.route("/exchange-rate", ExchangeRateRoutes);

export default PurchaseRoutes;
