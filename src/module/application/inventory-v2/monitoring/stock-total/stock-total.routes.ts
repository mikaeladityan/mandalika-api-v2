import { Hono } from "hono";
import { StockTotalController } from "./stock-total.controller.js";

const app = new Hono();

app.get("/",         StockTotalController.list);
app.get("/locations", StockTotalController.listLocations);

export default app;
