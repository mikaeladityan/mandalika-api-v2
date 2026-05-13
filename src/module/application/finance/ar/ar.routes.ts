import { Hono } from "hono";
import { FinanceARController } from "./ar.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { ReceiveARSchema, CreateARSchema } from "./ar.schema.js";

const FinanceARRoutes = new Hono();

FinanceARRoutes.get("/", FinanceARController.list);
FinanceARRoutes.post("/", validateBody(CreateARSchema), FinanceARController.create);
FinanceARRoutes.get("/:id", FinanceARController.detail);
FinanceARRoutes.patch("/:id/receipt", validateBody(ReceiveARSchema), FinanceARController.recordReceipt);

export default FinanceARRoutes;
