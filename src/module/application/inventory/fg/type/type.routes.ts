import { Hono } from "hono";
import { validateBody } from "../../../../../middleware/validation.js";
import { FGTypeController } from "./type.controller.js";
import { RequestFGTypeSchema } from "./type.schema.js";

export const FGTypeRoutes = new Hono();

FGTypeRoutes.get("/", FGTypeController.list);
FGTypeRoutes.post("/", validateBody(RequestFGTypeSchema), FGTypeController.create);
FGTypeRoutes.put(
    "/:id",
    validateBody(RequestFGTypeSchema.partial()),
    FGTypeController.update,
);
FGTypeRoutes.delete("/:id", FGTypeController.delete);
