import { Hono } from "hono";
import { StockDistributionRMController } from "./rm.controller.js";

const app = new Hono();

app.get("/export",    StockDistributionRMController.export);
app.get("/locations", StockDistributionRMController.listLocations);
app.get("/",          StockDistributionRMController.list);

export default app;
