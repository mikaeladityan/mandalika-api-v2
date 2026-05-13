import { Hono } from "hono";
import { FinanceKpiController } from "./kpi.controller.js";

const FinanceKpiRoutes = new Hono();

FinanceKpiRoutes.get("/", FinanceKpiController.getSummary);

export default FinanceKpiRoutes;
