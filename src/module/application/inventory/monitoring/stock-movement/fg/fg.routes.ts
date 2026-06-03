import { Hono } from "hono";
import { StockMovementFGController } from "./fg.controller.js";

const app = new Hono();

app.get("/export", StockMovementFGController.export);
app.get("/",       StockMovementFGController.list);

export default app;
