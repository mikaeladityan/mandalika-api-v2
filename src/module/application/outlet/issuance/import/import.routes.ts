import { Hono } from "hono";
import { validateBody } from "../../../../../middleware/validation.js";
import { IssuanceController } from "./import.controller.js";
import { RequestIssuanceExecuteSchema } from "./import.schema.js";

const IssuanceRoutes = new Hono();
IssuanceRoutes.post("/preview", IssuanceController.preview);
IssuanceRoutes.get("/preview/:import_id", IssuanceController.getPreview);
IssuanceRoutes.post("/execute", validateBody(RequestIssuanceExecuteSchema), IssuanceController.execute);

export default IssuanceRoutes;
