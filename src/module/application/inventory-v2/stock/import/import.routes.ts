import { Hono } from "hono";
import { validateBody } from "../../../../../middleware/validation.js";
import { StockImportController } from "./import.controller.js";
import { RequestStockImportSchema } from "./import.schema.js";

const StockImportRoutes = new Hono();

StockImportRoutes.get("/preview/:import_id", StockImportController.getPreview);
StockImportRoutes.post("/preview", StockImportController.preview);
StockImportRoutes.post(
    "/execute",
    validateBody(RequestStockImportSchema),
    StockImportController.execute,
);

export default StockImportRoutes;
