import { Hono } from "hono";
import { AuthRoutes } from "./auth/auth.routes.js";
import { ApplicationRoutes } from "./application/application.routes.js";
import { GlobalRoutes } from "./global/global.routes.js";

export const routes = new Hono();
routes.route("/auth", AuthRoutes);
routes.route("/app", ApplicationRoutes);
routes.route("/global", GlobalRoutes);
