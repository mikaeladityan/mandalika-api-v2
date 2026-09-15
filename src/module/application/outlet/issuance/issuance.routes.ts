import { Hono } from "hono";
import { validateBody } from "../../../../middleware/validation.js";
import { IssuanceController } from "./issuance.controller.js";
import { RequestIssuanceSchema } from "./issuance.schema.js";

const IssuanceRoutes = new Hono();
IssuanceRoutes.get("/", IssuanceController.list);
IssuanceRoutes.get("/grid", IssuanceController.grid);
IssuanceRoutes.get("/:id", IssuanceController.detail);
IssuanceRoutes.post("/", validateBody(RequestIssuanceSchema), IssuanceController.create);
IssuanceRoutes.patch("/:id", validateBody(RequestIssuanceSchema), IssuanceController.update);

export default IssuanceRoutes;
