import { Hono } from "hono";
import { FinanceCashController } from "./cash.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { CreateCashSchema } from "./cash.schema.js";

const FinanceCashRoutes = new Hono();

FinanceCashRoutes.get("/", FinanceCashController.list);
FinanceCashRoutes.post("/", validateBody(CreateCashSchema), FinanceCashController.create);
FinanceCashRoutes.get("/:id", FinanceCashController.detail);
FinanceCashRoutes.patch("/:id/post", FinanceCashController.post);

export default FinanceCashRoutes;
