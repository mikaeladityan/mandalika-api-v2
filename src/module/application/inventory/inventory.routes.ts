import { Hono } from "hono";
import { FGRoutes } from "./fg/fg.routes.js";
import { RMRoutes } from "./rm/rm.routes.js";

export const InventoryRoutes = new Hono();

InventoryRoutes.route("/fg", FGRoutes);
InventoryRoutes.route("/rm", RMRoutes);
