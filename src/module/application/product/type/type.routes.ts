import { Hono } from "hono";
import { TypeController } from "./type.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { RequestTypeSchema, UpdateTypeSchema } from "./type.schema.js";

export const TypeRoutes = new Hono();

TypeRoutes.get("/", TypeController.list);
TypeRoutes.post("/", validateBody(RequestTypeSchema), TypeController.create);
TypeRoutes.put("/:id", validateBody(UpdateTypeSchema), TypeController.update);
TypeRoutes.delete("/:id", TypeController.delete);
