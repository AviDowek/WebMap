/**
 * Health check route.
 */

import { Hono } from "hono";

const routes = new Hono();

routes.get("/api/health", (c) => c.json({ status: "ok" }));

export default routes;
