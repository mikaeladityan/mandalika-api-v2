import { Hono } from "hono";
import { StockController } from "./stock.controller.js";
import StockImportRoutes from "./import/import.routes.js";
import LocationRoutes from "./location/location.routes.js";

export const StockRoutes = new Hono();

StockRoutes.route("/import", StockImportRoutes);
StockRoutes.route("/locations", LocationRoutes);

StockRoutes.get("/warehouses", StockController.listWarehouses);
StockRoutes.get("/products", StockController.listProducts);
StockRoutes.get("/export", StockController.exportStock);
StockRoutes.get("/", StockController.listProductStock);
StockRoutes.post("/", StockController.upsertStock);

export default StockRoutes;
