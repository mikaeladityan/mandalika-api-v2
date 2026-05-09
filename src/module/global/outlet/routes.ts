import { Hono } from "hono";
import { OutletGlobalController } from "./controller.js";

export const OutletGlobalRoutes = new Hono();

OutletGlobalRoutes.get("/", OutletGlobalController.list);
