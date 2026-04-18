import { Hono } from "hono";
import { RmReceiptController } from "./rm-receipt.controller.js";
import { validateBody } from "../../../../../middleware/validation.js";
import { UpdateRmReceiptItemSchema } from "./rm-receipt.schema.js";

const app = new Hono();

app.get("/", RmReceiptController.list);
app.get("/:id", RmReceiptController.detail);
app.patch("/:id", RmReceiptController.updateItems);
app.patch("/:id/status", RmReceiptController.updateStatus);

export default app;
