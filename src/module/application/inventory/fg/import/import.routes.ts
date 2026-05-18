import { Hono } from "hono";
import { validateBody } from "../../../../../middleware/validation.js";
import { FGImportController } from "./import.controller.js";
import { RequestExecuteFGImportSchema } from "./import.schema.js";

export const FGImportRoutes = new Hono();

FGImportRoutes.get("/preview/:import_id", FGImportController.getPreview);
FGImportRoutes.post("/preview", FGImportController.preview);
FGImportRoutes.post(
    "/execute",
    validateBody(RequestExecuteFGImportSchema),
    FGImportController.execute,
);
FGImportRoutes.get("/status/:import_id", FGImportController.getStatus);
