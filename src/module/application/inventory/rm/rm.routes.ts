import { Hono } from "hono";
import { validateBody } from "../../../../middleware/validation.js";
import { RMController } from "./rm.controller.js";
import { BulkStatusRMSchema, RequestRMSchema } from "./rm.schema.js";
import { RMImportRoutes } from "./import/import.routes.js";
import { SupplierRoutes } from "./supplier/supplier.routes.js";
import { RawMatCategoryRoutes } from "./category/category.routes.js";
import { UnitRawMaterialRoutes } from "./unit/unit.routes.js";

export const RMRoutes = new Hono();

RMRoutes.route("/import", RMImportRoutes);
RMRoutes.route("/suppliers", SupplierRoutes);
RMRoutes.route("/categories", RawMatCategoryRoutes);
RMRoutes.route("/units", UnitRawMaterialRoutes);

RMRoutes.get("/export", RMController.export);
RMRoutes.delete("/clean", RMController.clean);
RMRoutes.put("/bulk-status", validateBody(BulkStatusRMSchema), RMController.bulkStatus);

RMRoutes.get("/:id", RMController.detail);
RMRoutes.put("/:id", validateBody(RequestRMSchema.partial()), RMController.update);
RMRoutes.patch("/:id", validateBody(RequestRMSchema.partial()), RMController.update);
RMRoutes.patch("/:id/restore", RMController.restore);
RMRoutes.delete("/:id", RMController.delete);

RMRoutes.get("/", RMController.list);
RMRoutes.post("/", validateBody(RequestRMSchema), RMController.create);
