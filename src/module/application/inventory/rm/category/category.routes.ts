import { Hono } from "hono";
import { validateBody } from "../../../../../middleware/validation.js";
import { RawMatCategoryController } from "./category.controller.js";
import {
    ChangeStatusRawMatCategorySchema,
    RequestRawMatCategorySchema,
    UpdateRawMatCategorySchema,
} from "./category.schema.js";

export const RawMatCategoryRoutes = new Hono();

RawMatCategoryRoutes.get("/:id", RawMatCategoryController.detail);
RawMatCategoryRoutes.put(
    "/:id",
    validateBody(UpdateRawMatCategorySchema),
    RawMatCategoryController.update,
);
RawMatCategoryRoutes.patch(
    "/:id",
    validateBody(UpdateRawMatCategorySchema),
    RawMatCategoryController.update,
);
RawMatCategoryRoutes.patch(
    "/:id/status",
    validateBody(ChangeStatusRawMatCategorySchema),
    RawMatCategoryController.changeStatus,
);
RawMatCategoryRoutes.delete("/:id", RawMatCategoryController.delete);

RawMatCategoryRoutes.get("/", RawMatCategoryController.list);
RawMatCategoryRoutes.post(
    "/",
    validateBody(RequestRawMatCategorySchema),
    RawMatCategoryController.create,
);
