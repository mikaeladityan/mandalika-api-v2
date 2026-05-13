import { Hono } from "hono";
import { FinanceAPController } from "./ap.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { PayAPSchema } from "./ap.schema.js";

const FinanceAPRoutes = new Hono();

FinanceAPRoutes.get("/", FinanceAPController.list);
FinanceAPRoutes.get("/:id", FinanceAPController.detail);
FinanceAPRoutes.patch("/:id/payment", validateBody(PayAPSchema), FinanceAPController.recordPayment);

export default FinanceAPRoutes;
