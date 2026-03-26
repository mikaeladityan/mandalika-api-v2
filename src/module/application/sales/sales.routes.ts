import { Hono } from "hono";
import { validateBody } from "../../../middleware/validation.js";
import { RequestSalesSchema } from "./sales.schema.js";
import { SalesController } from "./sales.controller.js";
import SalesImportRoutes from "./import/import.routes.js";

export const SalesRoutes = new Hono();
SalesRoutes.route("/import", SalesImportRoutes);

SalesRoutes.get("/rekap", SalesController.rekap);
SalesRoutes.get("/:product_id", SalesController.detail);

SalesRoutes.get("/", SalesController.list);

SalesRoutes.put("/", validateBody(RequestSalesSchema), SalesController.update);
SalesRoutes.post("/", validateBody(RequestSalesSchema), SalesController.create);
