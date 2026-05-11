import { Hono } from "hono";
import { OutletGlobalRoutes } from "./outlet/routes.js";
import ExchangeRateRoutes from "./exchange-rate/exchange-rate.routes.js";

export const GlobalRoutes = new Hono();

GlobalRoutes.route("/outlets", OutletGlobalRoutes);
GlobalRoutes.route("/exchange-rate", ExchangeRateRoutes);
