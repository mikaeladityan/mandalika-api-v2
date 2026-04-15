import { Hono } from "hono";
import { StockCardController } from "./stock-card.controller.js";

const app = new Hono();

// NOTE: /export must be registered BEFORE /:id style routes to avoid route conflict
app.get("/export", StockCardController.export);
app.get("/",       StockCardController.list);

export default app;
