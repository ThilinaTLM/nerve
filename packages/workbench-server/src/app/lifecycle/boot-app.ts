import type { ServerStartingError } from "@nervekit/contracts/status";
import { Hono } from "hono";
import { serveStatic } from "../../adapters/http/static-files.js";
import {
  createLifecycleAuthMiddleware,
  createLifecycleRoutes,
  type LifecycleControls,
} from "./lifecycle-routes.js";
import { createHostAllowlist } from "../../adapters/http/host-allowlist.js";
import { createLocalOnlyGate } from "../../adapters/http/auth-middleware.js";
import type { AccessService } from "../../domains/access/access-service.js";
import { hostGuard, legacyTokenRedirect } from "../server.js";

export interface BootAppOptions extends LifecycleControls {
  host: string;
  port: () => number;
  /** Undefined when the home has no usable token (see `ensureLocalToken`). */
  localToken: string | undefined;
  /** Device credentials work during storage upgrade when the daemon passes its access service. */
  access?: AccessService;
}

/** The app served while the runtime does not exist yet or storage failed. */
export function createBootApp(options: BootAppOptions): Hono {
  const app = new Hono();
  app.use(
    "*",
    hostGuard(
      createHostAllowlist({ host: options.host, access: options.access }),
      options.access,
    ),
  );
  const startingResponse = () => {
    const body: ServerStartingError = {
      error: "starting",
      lifecycle: options.holder.get(),
    };
    return Response.json(body, { status: 503 });
  };

  app.get("/health", (c) => c.json(options.holder.health()));
  const gate =
    options.access?.gate ??
    (options.localToken ? createLocalOnlyGate(options.localToken) : undefined);
  app.use("/api/*", createLifecycleAuthMiddleware(gate));
  app.route("/", createLifecycleRoutes(options));
  app.all("/api/*", () => startingResponse());
  app.all("/ws/*", () => startingResponse());

  app.get("*", async (c) => {
    const redirect = options.access
      ? await legacyTokenRedirect(options.access, c)
      : undefined;
    if (redirect) return redirect;
    return serveStatic(new URL(c.req.url).pathname, {
      host: options.host,
      port: options.port(),
    });
  });
  return app;
}
