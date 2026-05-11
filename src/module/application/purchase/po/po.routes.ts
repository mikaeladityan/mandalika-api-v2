import { Hono } from "hono";
import { POController } from "./po.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { CreatePOSchema, UpdatePOSchema, UpdatePOStatusSchema, UpdatePOTrackingSchema, ReceiveItemsSchema } from "./po.schema.js";

const routes = new Hono();

routes.get("/", POController.list);
routes.get("/open-po", POController.listOpenPO);
routes.get("/:id", POController.detail);
routes.get("/:id/receipts", POController.listReceipts);
routes.post("/", validateBody(CreatePOSchema), POController.create);
routes.post("/:id/receive", validateBody(ReceiveItemsSchema), POController.receiveItems);
routes.put("/:id", validateBody(UpdatePOSchema), POController.update);
routes.patch("/:id/status", validateBody(UpdatePOStatusSchema), POController.updateStatus);
routes.patch("/:id/tracking", validateBody(UpdatePOTrackingSchema), POController.updateTracking);
routes.delete("/:id", POController.destroy);

export default routes;
