import { Hono } from "hono";
import { ReceiptController } from "./receipt.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { CreateReceiptSchema, UpdateReceiptSchema } from "./receipt.schema.js";

const ReceiptRoutes = new Hono();

ReceiptRoutes.get("/", ReceiptController.list);
ReceiptRoutes.get("/open-pos", ReceiptController.listOpenPOs);
ReceiptRoutes.get("/:id", ReceiptController.detail);
ReceiptRoutes.post("/", validateBody(CreateReceiptSchema), ReceiptController.create);
ReceiptRoutes.put("/:id", validateBody(UpdateReceiptSchema), ReceiptController.update);
ReceiptRoutes.post("/:id/post", ReceiptController.post);
ReceiptRoutes.post("/:id/approve", ReceiptController.approve);
ReceiptRoutes.delete("/:id", ReceiptController.destroy);

export default ReceiptRoutes;
