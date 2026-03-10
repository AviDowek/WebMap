/**
 * Health check route.
 */

import { Hono } from "hono";

const routes = new Hono();

routes.get("/api/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

export default routes;
