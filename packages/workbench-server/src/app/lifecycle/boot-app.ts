import { getConnInfo } from "@hono/node-server/conninfo";
import type { ServerStartingError } from "@nervekit/contracts/status";
import { Hono } from "hono";
import { serveStatic } from "../../adapters/http/static-files.js";
import {
  createLifecycleAuthMiddleware,
  createLifecycleRoutes,
  type LifecycleControls,
} from "./lifecycle-routes.js";
import { remoteUiAuthRedirect } from "../server.js";

export interface BootAppOptions extends LifecycleControls {
  host: string;
  port: () => number;
  /** Undefined when the home has no usable token (see `ensureLocalToken`). */
  localToken: string | undefined;
}

/** The app served while the runtime does not exist yet or storage failed. */
export function createBootApp(options: BootAppOptions): Hono {
  const app = new Hono();
  const startingResponse = () => {
    const body: ServerStartingError = {
      error: "starting",
      lifecycle: options.holder.get(),
    };
    return Response.json(body, { status: 503 });
  };

  app.get("/health", (c) => c.json(options.holder.health()));
  app.use("/api/*", createLifecycleAuthMiddleware(options.localToken));
  app.route("/", createLifecycleRoutes(options));
  app.all("/api/*", () => startingResponse());
  app.all("/ws/*", () => startingResponse());

  app.get("*", async (c) => {
    const redirect = options.localToken
      ? remoteUiAuthRedirect(c.req.raw, options.localToken)
      : undefined;
    if (redirect) return redirect;
    return serveStatic(
      new URL(c.req.url).pathname,
      {
        host: options.host,
        port: options.port(),
        storage: { localToken: options.localToken ?? "" },
      },
      getConnInfo(c).remote.address,
    );
  });
  return app;
}
