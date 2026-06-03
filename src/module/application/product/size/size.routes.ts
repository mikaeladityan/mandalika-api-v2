import { Hono } from "hono";
import { ProductSizeController } from "./size.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { RequestSizeSchema, UpdateSizeSchema } from "./size.schema.js";

export const SizeRoutes = new Hono();

SizeRoutes.get("/", ProductSizeController.list);
SizeRoutes.post("/", validateBody(RequestSizeSchema), ProductSizeController.create);
SizeRoutes.put("/:id", validateBody(UpdateSizeSchema), ProductSizeController.update);
SizeRoutes.delete("/:id", ProductSizeController.delete);
