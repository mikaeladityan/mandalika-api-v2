import { Hono } from "hono";
import { GoodsReceiptController } from "./gr.controller.js";

export const GRRoutes = new Hono();

// Goods Receipt Routes
GRRoutes.get("/export", GoodsReceiptController.export);
GRRoutes.get("/", GoodsReceiptController.list);
GRRoutes.get("/:id", GoodsReceiptController.detail);
GRRoutes.get("/:id/export", GoodsReceiptController.exportDetail);
GRRoutes.post("/", GoodsReceiptController.create);
GRRoutes.post("/:id/post", GoodsReceiptController.post);
GRRoutes.patch("/:id/cancel", GoodsReceiptController.cancel);

export default GRRoutes;
