import { Hono } from "hono";
import { SalesImportController } from "./import.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { RequestSalesImportSchema } from "./import.schema.js";

const SalesImportRoutes = new Hono();

SalesImportRoutes.get("/preview/:import_id", SalesImportController.getPreview);
SalesImportRoutes.post("/preview", SalesImportController.preview);
SalesImportRoutes.post(
    "/execute",
    validateBody(RequestSalesImportSchema),
    SalesImportController.execute,
);

export default SalesImportRoutes;
