import { Hono } from "hono";
import { ManufacturingController } from "./manufacturing.controller.js";
import { validateBody } from "../../../middleware/validation.js";
import {
    RequestCreateProductionSchema,
    RequestChangeStatusSchema,
    RequestSubmitResultSchema,
    RequestQcActionSchema,
} from "./manufacturing.schema.js";

const app = new Hono();

app.get("/", ManufacturingController.list);
app.post("/", validateBody(RequestCreateProductionSchema), ManufacturingController.create);
app.get("/:id", ManufacturingController.detail);
app.patch("/:id/status", validateBody(RequestChangeStatusSchema), ManufacturingController.changeStatus);
app.post("/:id/result", validateBody(RequestSubmitResultSchema), ManufacturingController.submitResult);
app.post("/:id/qc", validateBody(RequestQcActionSchema), ManufacturingController.qcAction);
app.delete("/:id", ManufacturingController.delete);

export default app;
