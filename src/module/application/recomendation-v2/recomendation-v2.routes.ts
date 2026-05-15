import { Hono } from "hono";
import { RecomendationV2Controller } from "./recomendation-v2.controller.js";

const routes = new Hono();

routes.get("/", RecomendationV2Controller.list);
routes.get("/export", RecomendationV2Controller.export);
routes.get("/open-po", RecomendationV2Controller.listOpenPoCell);
routes.post("/open-po", RecomendationV2Controller.createOpenPoCell);
routes.patch("/open-po/:itemId", RecomendationV2Controller.updateOpenPoCellQty);
routes.delete("/open-po/:itemId", RecomendationV2Controller.deleteOpenPoCellItem);
routes.post("/order", RecomendationV2Controller.saveWorkOrder);
routes.post("/approve", RecomendationV2Controller.approveWorkOrder);
routes.post("/bulk-horizon", RecomendationV2Controller.bulkSaveHorizon);
routes.post("/need-override", RecomendationV2Controller.saveNeedOverride);
routes.delete("/need-override", RecomendationV2Controller.deleteNeedOverride);
routes.patch("/moq", RecomendationV2Controller.updateMoq);
routes.patch("/hide", RecomendationV2Controller.bulkToggleHide);
routes.get("/suppliers", RecomendationV2Controller.listSuppliersForMaterial);
routes.delete("/:id", RecomendationV2Controller.destroyWorkOrder);

export default routes;
