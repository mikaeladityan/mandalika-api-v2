import { Hono } from "hono";
import { validateBody } from "../../../../../middleware/validation.js";

import { 
    CreateRmTransferSchema, 
    UpdateRmTransferStatusSchema 
} from "./rm-transfer.schema.js";
import { RmTransferController } from "./rm-transfer.controller.js";

const rmTransfer = new Hono();

rmTransfer.get("/", RmTransferController.list);
rmTransfer.get("/stock-check", RmTransferController.stockCheck);
rmTransfer.get("/:id", RmTransferController.detail);
rmTransfer.post("/", validateBody(CreateRmTransferSchema), RmTransferController.create);
rmTransfer.patch("/:id/status", validateBody(UpdateRmTransferStatusSchema), RmTransferController.updateStatus);
rmTransfer.patch("/:id/items/:itemId", RmTransferController.updateItemQuantity);
rmTransfer.delete("/clean/cancelled", RmTransferController.cleanCancelled);

export default rmTransfer;
