import { Hono } from "hono";
import { LocationController } from "./location.controller.js";

const LocationRoutes = new Hono();

LocationRoutes.get("/", LocationController.listStockLocation);
LocationRoutes.get("/locations", LocationController.listLocations);

export default LocationRoutes;
