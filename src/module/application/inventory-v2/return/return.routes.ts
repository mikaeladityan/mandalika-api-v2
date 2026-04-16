import { Hono } from "hono";
import { ReturnController } from "./return.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { RequestReturnSchema, UpdateReturnStatusSchema } from "./return.schema.js";

const ReturnRoutes = new Hono();

ReturnRoutes.get("/", ReturnController.list);
ReturnRoutes.get("/export", ReturnController.export);
ReturnRoutes.post("/", validateBody(RequestReturnSchema), ReturnController.create);
ReturnRoutes.get("/:id", ReturnController.detail);
ReturnRoutes.patch(
    "/:id/status",
    validateBody(UpdateReturnStatusSchema),
    ReturnController.updateStatus,
);

export default ReturnRoutes;
