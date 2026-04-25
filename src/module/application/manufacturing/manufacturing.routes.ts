import { Hono } from "hono";
import { ManufacturingController } from "./manufacturing.controller.js";
import inventoryRmMovment from "./inventory/rm-movement/rm-movement.routes.js";
import inventoryRmReceipt from "./inventory/rm-receipt/rm-receipt.routes.js";
import inventoryRmTransfer from "./inventory/rm-transfer/rm-transfer.routes.js";
import inventoryRmUsage from "./inventory/rm-usage/rm-usage.routes.js";
import inventoryRmSkuTransfer from "./inventory/rm-sku-transfer/rm-sku-transfer.routes.js";
import inventoryManualWasteRM from "./inventory/manual-waste-rm/manual-waste-rm.routes.js";
import { validateBody } from "../../../middleware/validation.js";
import {
    RequestCreateProductionSchema,
    RequestChangeStatusSchema,
    RequestSubmitResultSchema,
    RequestQcActionSchema,
    RequestUpdateProductionSchema,
} from "./manufacturing.schema.js";

const app = new Hono();

app.get("/", ManufacturingController.list);
app.post("/", validateBody(RequestCreateProductionSchema), ManufacturingController.create);
app.get("/wastes", ManufacturingController.listWastes);
app.get("/:id", ManufacturingController.detail);
app.patch("/:id/status", validateBody(RequestChangeStatusSchema), ManufacturingController.changeStatus);
app.patch("/:id", validateBody(RequestUpdateProductionSchema), ManufacturingController.update);
app.post("/:id/result", validateBody(RequestSubmitResultSchema), ManufacturingController.submitResult);
app.post("/:id/qc", validateBody(RequestQcActionSchema), ManufacturingController.qcAction);
app.delete("/:id", ManufacturingController.delete);
app.delete("/clean/cancelled", ManufacturingController.cleanCancelled);
app.route("/inventory/rm-movement", inventoryRmMovment);
app.route("/inventory/rm-receipt", inventoryRmReceipt);
app.route("/inventory/rm-transfer", inventoryRmTransfer);
app.route("/inventory/rm-usage", inventoryRmUsage);
app.route("/inventory/rm-sku-transfer", inventoryRmSkuTransfer);
app.route("/inventory/manual-waste-rm", inventoryManualWasteRM);

export default app;
