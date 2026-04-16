import { Hono } from "hono";
import { StockTotalController } from "./stock-total.controller.js";

const app = new Hono();

app.get("/export",    StockTotalController.export);
app.get("/locations", StockTotalController.listLocations);
app.get("/",          StockTotalController.list);

export default app;
