import { Hono } from "hono";
import { GRController } from "./gr.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { RequestGoodsReceiptSchema, RequestUpdateGoodsReceiptSchema } from "./gr.schema.js";

export const GRRoutes = new Hono();

GRRoutes.get("/", GRController.list);
GRRoutes.get("/stats", GRController.stats);
GRRoutes.get("/export", GRController.export);
GRRoutes.get("/:id", GRController.detail);
GRRoutes.post("/", validateBody(RequestGoodsReceiptSchema), GRController.create);
GRRoutes.patch("/:id", validateBody(RequestUpdateGoodsReceiptSchema), GRController.update);
GRRoutes.post("/:id/post", GRController.post);
GRRoutes.patch("/:id/cancel", GRController.cancel);

export default GRRoutes;
