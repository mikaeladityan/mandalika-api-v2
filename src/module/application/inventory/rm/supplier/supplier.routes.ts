import { Hono } from "hono";
import { validateBody } from "../../../../../middleware/validation.js";
import { SupplierController } from "./supplier.controller.js";
import { BulkDeleteSupplierSchema, RequestSupplierSchema } from "./supplier.schema.js";

export const SupplierRoutes = new Hono();

SupplierRoutes.post(
    "/bulk-delete",
    validateBody(BulkDeleteSupplierSchema),
    SupplierController.bulkDelete,
);

SupplierRoutes.get("/:id", SupplierController.detail);
SupplierRoutes.put(
    "/:id",
    validateBody(RequestSupplierSchema.partial()),
    SupplierController.update,
);
SupplierRoutes.delete("/:id", SupplierController.delete);

SupplierRoutes.get("/", SupplierController.list);
SupplierRoutes.post("/", validateBody(RequestSupplierSchema), SupplierController.create);
