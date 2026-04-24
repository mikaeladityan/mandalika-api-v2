import { Hono } from "hono";
import { DOController } from "./do.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { RequestDeliveryOrderSchema, UpdateDeliveryOrderStatusSchema, RequestUpdateDeliveryOrderSchema } from "./do.schema.js";

export const DORoutes = new Hono();

DORoutes.get("/", DOController.list);
DORoutes.get("/stock", DOController.getStock);
DORoutes.get("/export", DOController.export);
DORoutes.get("/:id", DOController.detail);


// SOP: Direct validateBody in routes
DORoutes.post("/", validateBody(RequestDeliveryOrderSchema), DOController.create);
DORoutes.patch("/:id", validateBody(RequestUpdateDeliveryOrderSchema), DOController.update);
DORoutes.patch("/:id/status", validateBody(UpdateDeliveryOrderStatusSchema), DOController.updateStatus);

export default DORoutes;
