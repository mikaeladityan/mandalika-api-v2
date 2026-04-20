import { Hono } from "hono";
import { RmUsageController } from "./rm-usage.controller.js";

const inventoryRmUsage = new Hono();

inventoryRmUsage.get("/", RmUsageController.list);

export default inventoryRmUsage;
