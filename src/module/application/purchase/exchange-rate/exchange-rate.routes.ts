import { Hono } from "hono";
import { ExchangeRateController } from "./exchange-rate.controller.js";

const ExchangeRateRoutes = new Hono();

ExchangeRateRoutes.get("/", ExchangeRateController.getRate);

export default ExchangeRateRoutes;
