import { Hono } from "hono";
import { PurchaseController } from "./purchase.controller.js";

const PurchaseRoutes = new Hono();

PurchaseRoutes.get("/", PurchaseController.list);
PurchaseRoutes.get("/summary", PurchaseController.summary);
PurchaseRoutes.get("/export", PurchaseController.export);

export default PurchaseRoutes;
