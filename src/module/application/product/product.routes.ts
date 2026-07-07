import { Hono } from "hono";
import { validateBody } from "../../../middleware/validation.js";
import { ProductController } from "./product.controller.js";
import { UnitRoutes } from "./unit/unit.routes.js";
import { TypeRoutes } from "./type/type.routes.js";
import { SizeRoutes } from "./size/size.routes.js";
import { roleMiddleware } from "../../../middleware/auth.js";
import { RequestProductSchema, UpdateProductSchema, UpdateReferenceEdarSchema } from "./product.schema.js";
import ProductImportRoutes from "./import/import.routes.js";

export const ProductRoutes = new Hono();

// -- Sub
ProductRoutes.route("/import", ProductImportRoutes);
ProductRoutes.route("/units", UnitRoutes);
ProductRoutes.route("/types", TypeRoutes);
ProductRoutes.route("/sizes", SizeRoutes);

// -- Main
ProductRoutes.get("/export", ProductController.export);
ProductRoutes.patch("/status/:id", ProductController.status);
ProductRoutes.post("/:id/resync", ProductController.resync);
ProductRoutes.delete("/clean", ProductController.clean);

ProductRoutes.patch(
    "/reference-edar",
    roleMiddleware(["DEVELOPER"]),
    validateBody(UpdateReferenceEdarSchema),
    ProductController.updateReferenceEdar,
);

ProductRoutes.put("/:id", validateBody(UpdateProductSchema), ProductController.update);
ProductRoutes.get("/:id", ProductController.detail);

ProductRoutes.get("/", ProductController.list);
ProductRoutes.post("/", validateBody(RequestProductSchema), ProductController.create);
