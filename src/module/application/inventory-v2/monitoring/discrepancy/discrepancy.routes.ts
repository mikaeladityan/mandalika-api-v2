import { Hono } from "hono";
import { DiscrepancyController } from "./discrepancy.controller.js";

const app = new Hono();

app.get("/export", DiscrepancyController.export);
app.get("/",       DiscrepancyController.list);

export default app;
