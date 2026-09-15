import { Hono } from "hono";
import { validateBody } from "../../../../../middleware/validation.js";
import { BardatController } from "./import.controller.js";
import { RequestBardatExecuteSchema } from "./import.schema.js";

const BardatRoutes = new Hono();
BardatRoutes.post("/preview", BardatController.preview);
BardatRoutes.get("/preview/:import_id", BardatController.getPreview);
BardatRoutes.post("/execute", validateBody(RequestBardatExecuteSchema), BardatController.execute);

export default BardatRoutes;
