import { Hono } from "hono";

import { getProvActivity } from "../prov/store.js";

export const provRoute = new Hono();

provRoute.get("/activity/:uuid", (c) => {
  const rec = getProvActivity(c.req.param("uuid"));
  if (!rec) {
    return c.json({ type: "NoSuchProvActivity", status: 404 }, 404);
  }
  return c.json(rec.block);
});
