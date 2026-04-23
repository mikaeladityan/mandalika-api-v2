import { Hono } from "hono";
import { RFQController } from "./rfq.controller.js";

const RFQRoutes = new Hono();

RFQRoutes.get("/", RFQController.list);
RFQRoutes.get("/:id", RFQController.detail);
RFQRoutes.post("/", RFQController.create);
RFQRoutes.put("/:id", RFQController.update);
RFQRoutes.patch("/:id/status", RFQController.updateStatus);
RFQRoutes.post("/:id/convert", RFQController.convertToPO);
RFQRoutes.delete("/:id", RFQController.destroy);

export default RFQRoutes;
