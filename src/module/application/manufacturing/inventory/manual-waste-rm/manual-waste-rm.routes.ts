import { Hono } from "hono";
import { validateBody } from "../../../../../middleware/validation.js";
import { CreateManualWasteRMSchema, ReturnManualWasteRMSchema } from "./manual-waste-rm.schema.js";
import { ManualWasteRMController } from "./manual-waste-rm.controller.js";

const manualWasteRM = new Hono();

manualWasteRM.get("/", ManualWasteRMController.list);
manualWasteRM.get("/stock-check", ManualWasteRMController.stockCheck);
manualWasteRM.get("/:id", ManualWasteRMController.detail);
manualWasteRM.post("/", validateBody(CreateManualWasteRMSchema), ManualWasteRMController.create);
manualWasteRM.post("/:id/return", validateBody(ReturnManualWasteRMSchema), ManualWasteRMController.returnWaste);
manualWasteRM.delete("/:id", ManualWasteRMController.destroy);

export default manualWasteRM;
