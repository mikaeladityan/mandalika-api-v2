import { Hono } from "hono";
import { OutletController } from "./outlet.controller.js";
import { OutletInventoryRoutes } from "./inventory/outlet-inventory.routes.js";
import { validateBody } from "../../../middleware/validation.js";
import { RequestOutletSchema, UpdateOutletSchema } from "./outlet.schema.js";

export const OutletRoutes = new Hono();

// ─── Outlet CRUD ──────────────────────────────────────────────────────────────

OutletRoutes.get("/", OutletController.list);
OutletRoutes.post("/", validateBody(RequestOutletSchema), OutletController.create);
OutletRoutes.delete("/clean", OutletController.clean);

OutletRoutes.get("/:id", OutletController.detail);
OutletRoutes.put("/:id", validateBody(UpdateOutletSchema), OutletController.update);
OutletRoutes.patch("/:id/status", OutletController.toggleStatus);
OutletRoutes.delete("/:id", OutletController.delete);

// ─── Outlet Inventory ─────────────────────────────────────────────────────────

OutletRoutes.route("/:id/inventory", OutletInventoryRoutes);
