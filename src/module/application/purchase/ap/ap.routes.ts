import { Hono } from "hono";
import { APController } from "./ap.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { UpdateAPPaymentSchema } from "./ap.schema.js";

const APRoutes = new Hono();

APRoutes.get("/", APController.list);
APRoutes.get("/:id", APController.detail);
APRoutes.patch("/:id/payment", validateBody(UpdateAPPaymentSchema), APController.updatePayment);

export default APRoutes;
