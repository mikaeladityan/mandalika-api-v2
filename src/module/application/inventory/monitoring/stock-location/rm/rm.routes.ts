import { Hono } from "hono";
import { StockLocationRMController } from "./rm.controller.js";

const app = new Hono();

app.get("/export",    StockLocationRMController.export);
app.get("/locations", StockLocationRMController.listAvailableLocations);
app.get("/",          StockLocationRMController.list);

export default app;
