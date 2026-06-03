import { Hono } from "hono";
import { validateBody } from "../../../../middleware/validation.js";
import { ProductImportController } from "./import.controller.js";
import { ExecuteImportSchema } from "./import.schema.js";

const ProductImportRoutes = new Hono();

ProductImportRoutes.get("/preview/:import_id", ProductImportController.getPreview);
ProductImportRoutes.post("/preview", ProductImportController.preview);
ProductImportRoutes.post(
    "/execute",
    validateBody(ExecuteImportSchema),
    ProductImportController.execute,
);
ProductImportRoutes.get("/status/:import_id", ProductImportController.getStatus);

export default ProductImportRoutes;
