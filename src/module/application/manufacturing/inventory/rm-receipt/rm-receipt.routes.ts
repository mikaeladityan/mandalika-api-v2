import { Hono } from "hono";
import { RmReceiptController } from "./rm-receipt.controller.js";

const app = new Hono();

app.get("/", RmReceiptController.list);
app.get("/:id", RmReceiptController.detail);
app.patch("/:id/status", RmReceiptController.updateStatus);

export default app;
