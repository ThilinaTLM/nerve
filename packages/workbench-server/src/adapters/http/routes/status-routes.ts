import { Hono } from "hono";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";
import { version } from "../../../app/version.js";

type StatusRoutesContext = ServerAdapterContexts["http"]["status"];

export function createStatusRoutes(state: StatusRoutesContext): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok", version }));
  app.get("/client-config", (c) =>
    c.json({
      url: `http://${state.host}:${state.port}`,
      wsUrl: `ws://${state.host}:${state.port}/ws`,
      status: state.statusResponse(),
    }),
  );
  return app;
}
