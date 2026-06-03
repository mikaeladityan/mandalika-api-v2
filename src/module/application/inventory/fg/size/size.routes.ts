import { Hono } from "hono";
import { validateBody } from "../../../../../middleware/validation.js";
import { FGSizeController } from "./size.controller.js";
import { RequestFGSizeSchema } from "./size.schema.js";

export const FGSizeRoutes = new Hono();

FGSizeRoutes.get("/", FGSizeController.list);
FGSizeRoutes.post("/", validateBody(RequestFGSizeSchema), FGSizeController.create);
FGSizeRoutes.put(
    "/:id",
    validateBody(RequestFGSizeSchema.partial()),
    FGSizeController.update,
);
FGSizeRoutes.delete("/:id", FGSizeController.delete);
