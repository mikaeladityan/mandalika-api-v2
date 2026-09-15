import { Hono } from "hono";
import { validateBody } from "../../../../middleware/validation.js";
import { BardatController } from "./bardat.controller.js";
import { RequestBardatSchema } from "./bardat.schema.js";

const BardatRoutes = new Hono();
BardatRoutes.get("/", BardatController.list);
BardatRoutes.get("/grid", BardatController.grid);
BardatRoutes.get("/:id", BardatController.detail);
BardatRoutes.post("/", validateBody(RequestBardatSchema), BardatController.create);
BardatRoutes.patch("/:id", validateBody(RequestBardatSchema), BardatController.update);

export default BardatRoutes;
