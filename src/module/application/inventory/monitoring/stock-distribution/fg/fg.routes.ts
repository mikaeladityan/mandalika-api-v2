import { Hono } from "hono";
import { StockDistributionFGController } from "./fg.controller.js";

const app = new Hono();

app.get("/export",    StockDistributionFGController.export);
app.get("/locations", StockDistributionFGController.listLocations);
app.get("/",          StockDistributionFGController.list);

export default app;
