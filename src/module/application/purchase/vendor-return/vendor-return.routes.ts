import { Hono } from "hono";
import { VendorReturnController } from "./vendor-return.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { CreateVendorReturnSchema, UpdateVendorReturnSchema } from "./vendor-return.schema.js";

const VendorReturnRoutes = new Hono();

VendorReturnRoutes.get("/", VendorReturnController.list);
VendorReturnRoutes.get("/:id", VendorReturnController.detail);
VendorReturnRoutes.post("/", validateBody(CreateVendorReturnSchema), VendorReturnController.create);
VendorReturnRoutes.put("/:id", validateBody(UpdateVendorReturnSchema), VendorReturnController.update);
VendorReturnRoutes.post("/:id/post", VendorReturnController.post);
VendorReturnRoutes.post("/:id/approve", VendorReturnController.approve);
VendorReturnRoutes.delete("/:id", VendorReturnController.destroy);

export default VendorReturnRoutes;
