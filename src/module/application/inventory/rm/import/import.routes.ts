import { Hono } from "hono";
import { validateBody } from "../../../../../middleware/validation.js";
import { RMImportController } from "./import.controller.js";
import { RequestExecuteRMImportSchema } from "./import.schema.js";

export const RMImportRoutes = new Hono();

RMImportRoutes.get("/preview/:import_id", RMImportController.getPreview);
RMImportRoutes.post("/preview", RMImportController.preview);
RMImportRoutes.post(
    "/execute",
    validateBody(RequestExecuteRMImportSchema),
    RMImportController.execute,
);
RMImportRoutes.get("/status/:import_id", RMImportController.getStatus);
