import { Hono } from "hono";
import { StockMovementRMController } from "./rm.controller.js";

const app = new Hono();

app.get("/export", StockMovementRMController.export);
app.get("/",       StockMovementRMController.list);

export default app;
