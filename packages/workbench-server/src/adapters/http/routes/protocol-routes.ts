import { Hono } from "hono";
import {
  ProtocolHttpDispatcher,
  type ProtocolAdapterContext,
} from "../../protocol/http-dispatcher.js";

export function createProtocolRoutes(state: ProtocolAdapterContext): Hono {
  const app = new Hono();
  const dispatcher = new ProtocolHttpDispatcher(state);

  app.post("/protocol/v1", (c) => dispatcher.dispatch(c.req.raw));

  return app;
}
