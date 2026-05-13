import { Hono } from "hono";
import { RFQController } from "./rfq.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { CreateRFQSchema, UpdateRFQSchema, UpdateRFQStatusSchema, ConvertToPOSchema } from "./rfq.schema.js";

const RFQRoutes = new Hono();

RFQRoutes.get("/consolidation-items", RFQController.listConsolidationItems);
RFQRoutes.get("/", RFQController.list);
RFQRoutes.get("/:id", RFQController.detail);
RFQRoutes.post("/", validateBody(CreateRFQSchema), RFQController.create);
RFQRoutes.put("/:id", validateBody(UpdateRFQSchema), RFQController.update);
RFQRoutes.patch("/:id/status", validateBody(UpdateRFQStatusSchema), RFQController.updateStatus);
RFQRoutes.post("/:id/convert", validateBody(ConvertToPOSchema), RFQController.convertToPO);
RFQRoutes.delete("/:id", RFQController.destroy);

export default RFQRoutes;
