import { Hono } from "hono";
import { StockLocationFGController } from "./fg.controller.js";

const app = new Hono();

app.get("/export",    StockLocationFGController.export);
app.get("/locations", StockLocationFGController.listAvailableLocations);
app.get("/",          StockLocationFGController.list);

export default app;
