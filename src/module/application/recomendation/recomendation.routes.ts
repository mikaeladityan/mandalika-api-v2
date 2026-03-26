import { Hono } from "hono";
import { RecomendationController } from "./recomendation.controller.js";

const RecomendationRoutes = new Hono();

RecomendationRoutes.get("/", RecomendationController.list);
RecomendationRoutes.post("/order", RecomendationController.saveOrderQuantity);
RecomendationRoutes.post("/approve", RecomendationController.approve);
RecomendationRoutes.delete("/:id", RecomendationController.destroy);

export default RecomendationRoutes;
