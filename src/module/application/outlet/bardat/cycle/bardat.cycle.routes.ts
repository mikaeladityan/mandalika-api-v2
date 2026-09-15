import { Hono } from "hono";
import { BardatCycleController } from "./bardat.cycle.controller.js";

export const BardatCycleRoutes = new Hono();
BardatCycleRoutes.get("/", BardatCycleController.list);
BardatCycleRoutes.put("/", BardatCycleController.save);
BardatCycleRoutes.patch("/:outletId/reset", BardatCycleController.reset);
