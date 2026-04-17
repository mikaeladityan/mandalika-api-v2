import { Hono } from "hono";
import { RmMovmentController } from "./rm-movement.controller.js";

const reportRmMovment = new Hono();

reportRmMovment.get("/", RmMovmentController.list);

export default reportRmMovment;
