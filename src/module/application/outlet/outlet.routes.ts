import { Hono } from "hono";
import { OutletController } from "./outlet.controller.js";
import { OutletInventoryRoutes } from "./inventory/outlet-inventory.routes.js";
import { validateBody } from "../../../middleware/validation.js";
import { BulkDeleteSchema, BulkStatusSchema, RequestOutletSchema, UpdateOutletSchema } from "./outlet.schema.js";

import { OutletImportRoutes } from "./import/import.routes.js";
import BardatImportRoutes from "./bardat/import/import.routes.js";
import BardatRoutes from "./bardat/bardat.routes.js";
import IssuanceImportRoutes from "./issuance/import/import.routes.js";
import IssuanceRoutes from "./issuance/issuance.routes.js";

export const OutletRoutes = new Hono();

// ─── Sub-Modules ──────────────────────────────────────────────────────────────
OutletRoutes.route("/import", OutletImportRoutes);
OutletRoutes.route("/bardat/import", BardatImportRoutes);
OutletRoutes.route("/bardat", BardatRoutes);
OutletRoutes.route("/issuance/import", IssuanceImportRoutes);
OutletRoutes.route("/issuance", IssuanceRoutes);

// ─── Outlet CRUD ──────────────────────────────────────────────────────────────
OutletRoutes.get("/", OutletController.list);
OutletRoutes.post("/", validateBody(RequestOutletSchema), OutletController.create);
OutletRoutes.delete("/clean", OutletController.clean);
OutletRoutes.post("/bulk-status", validateBody(BulkStatusSchema), OutletController.bulkStatus);
OutletRoutes.post("/bulk-delete", validateBody(BulkDeleteSchema), OutletController.bulkDelete);

OutletRoutes.get("/:id", OutletController.detail);
OutletRoutes.put("/:id", validateBody(UpdateOutletSchema), OutletController.update);
OutletRoutes.patch("/:id/status", OutletController.toggleStatus);

// ─── Outlet Inventory ─────────────────────────────────────────────────────────

OutletRoutes.route("/:id/inventory", OutletInventoryRoutes);
