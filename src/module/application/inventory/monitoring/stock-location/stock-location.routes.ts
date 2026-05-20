import { Hono } from "hono";
import { StockLocationController } from "./stock-location.controller.js";

const app = new Hono();

app.get("/export",    StockLocationController.export);
app.get("/locations", StockLocationController.listAvailableLocations);
app.get("/",          StockLocationController.list);

export default app;
