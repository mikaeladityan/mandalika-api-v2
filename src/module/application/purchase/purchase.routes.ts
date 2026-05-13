import { Hono } from "hono";
import RFQRoutes from "./rfq/rfq.routes.js";
import PORoutes from "./po/po.routes.js";
import ReceiptRoutes from "./receipt/receipt.routes.js";
import TrackingRoutes from "./tracking/tracking.routes.js";
import VendorReturnRoutes from "./vendor-return/vendor-return.routes.js";
const PurchaseRoutes = new Hono();

PurchaseRoutes.route("/rfq", RFQRoutes);
PurchaseRoutes.route("/po", PORoutes);
PurchaseRoutes.route("/receipt", ReceiptRoutes);
PurchaseRoutes.route("/tracking", TrackingRoutes);
PurchaseRoutes.route("/vendor-return", VendorReturnRoutes);

export default PurchaseRoutes;
