import { Hono } from "hono";
import { StockImportController } from "./import.controller.js";

const StockImportRoutes = new Hono();

StockImportRoutes.get("/preview/:import_id", StockImportController.getPreview);
StockImportRoutes.post("/preview", StockImportController.preview);
StockImportRoutes.post("/execute", StockImportController.execute);

export default StockImportRoutes;
