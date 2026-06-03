import { Hono } from "hono";
import { validateBody } from "../../../../../middleware/validation.js";
import { UnitRawMaterialController } from "./unit.controller.js";
import { RequestRawMaterialUnitSchema, UpdateRawMaterialUnitSchema } from "./unit.schema.js";

export const UnitRawMaterialRoutes = new Hono();

UnitRawMaterialRoutes.get("/:id", UnitRawMaterialController.detail);
UnitRawMaterialRoutes.put(
    "/:id",
    validateBody(UpdateRawMaterialUnitSchema),
    UnitRawMaterialController.update,
);
UnitRawMaterialRoutes.patch(
    "/:id",
    validateBody(UpdateRawMaterialUnitSchema),
    UnitRawMaterialController.update,
);
UnitRawMaterialRoutes.delete("/:id", UnitRawMaterialController.delete);

UnitRawMaterialRoutes.get("/", UnitRawMaterialController.list);
UnitRawMaterialRoutes.post(
    "/",
    validateBody(RequestRawMaterialUnitSchema),
    UnitRawMaterialController.create,
);
