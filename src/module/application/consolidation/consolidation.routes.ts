import { Hono } from "hono";
import { ConsolidationController } from "./consolidation.controller.js";

const ConsolidationRoutes = new Hono();

ConsolidationRoutes.get("/", ConsolidationController.list);
ConsolidationRoutes.get("/summary", ConsolidationController.summary);
ConsolidationRoutes.get("/export", ConsolidationController.export);
ConsolidationRoutes.patch("/bulk-status", ConsolidationController.bulkUpdateStatus);

export default ConsolidationRoutes;
