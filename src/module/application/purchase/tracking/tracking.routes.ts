import { Hono } from "hono";
import { TrackingController } from "./tracking.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { UpdateTrackingSchema } from "./tracking.schema.js";

const TrackingRoutes = new Hono();

TrackingRoutes.get("/", TrackingController.list);
TrackingRoutes.get("/:po_id", TrackingController.detail);
TrackingRoutes.patch("/:po_id", validateBody(UpdateTrackingSchema), TrackingController.update);

export default TrackingRoutes;
