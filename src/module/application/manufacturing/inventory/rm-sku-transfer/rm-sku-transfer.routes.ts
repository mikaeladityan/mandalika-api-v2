import { Hono } from "hono";
import { RmSkuTransferController } from "./rm-sku-transfer.controller.js";
import { validateBody } from "../../../../../middleware/validation.js";
import { RequestRmSkuTransferSchema } from "./rm-sku-transfer.schema.js";

const RmSkuTransferRoutes = new Hono();

RmSkuTransferRoutes.post("/", validateBody(RequestRmSkuTransferSchema), RmSkuTransferController.transfer);
RmSkuTransferRoutes.get("/stock", RmSkuTransferController.getStock);
RmSkuTransferRoutes.get("/stock-all", RmSkuTransferController.getStockAll);

export default RmSkuTransferRoutes;
