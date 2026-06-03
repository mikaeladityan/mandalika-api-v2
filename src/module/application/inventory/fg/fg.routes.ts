import { Hono } from "hono";
import { validateBody } from "../../../../middleware/validation.js";
import { FGController } from "./fg.controller.js";
import { BulkStatusFGSchema, RequestFGSchema } from "./fg.schema.js";
import { FGImportRoutes } from "./import/import.routes.js";
import { FGSizeRoutes } from "./size/size.routes.js";
import { FGTypeRoutes } from "./type/type.routes.js";

export const FGRoutes = new Hono();

FGRoutes.route("/import", FGImportRoutes);
FGRoutes.route("/sizes", FGSizeRoutes);
FGRoutes.route("/types", FGTypeRoutes);

FGRoutes.get("/export", FGController.export);
FGRoutes.put("/bulk-status", validateBody(BulkStatusFGSchema), FGController.bulkStatus);
FGRoutes.patch("/status/:id", FGController.status);
FGRoutes.delete("/clean", FGController.clean);

FGRoutes.put("/:id", validateBody(RequestFGSchema.partial()), FGController.update);
FGRoutes.get("/:id", FGController.detail);

FGRoutes.get("/", FGController.list);
FGRoutes.post("/", validateBody(RequestFGSchema), FGController.create);
