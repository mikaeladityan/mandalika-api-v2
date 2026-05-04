import { Hono } from "hono";
import { POController } from "./po.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { CreatePOSchema, UpdatePOSchema, UpdatePOStatusSchema } from "./po.schema.js";

const routes = new Hono();

routes.get("/", POController.list);
routes.get("/:id", POController.detail);
routes.post("/", validateBody(CreatePOSchema), POController.create);
routes.put("/:id", validateBody(UpdatePOSchema), POController.update);
routes.patch("/:id/status", validateBody(UpdatePOStatusSchema), POController.updateStatus);
routes.delete("/:id", POController.destroy);

export default routes;
