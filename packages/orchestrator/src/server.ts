import { join } from "node:path";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createId, type DaemonFile, type StatusResponse } from "@nerve/shared";
import { Hono } from "hono";
import { AuthManager } from "./auth.js";
import { EventBus } from "./events.js";
import { createApiAuthMiddleware } from "./http/auth-middleware.js";
import { serveStatic } from "./http/static-files.js";
import { IndexStore } from "./index-store.js";
import { OAuthFlowManager } from "./oauth-flow.js";
import { RuntimeRegistry } from "./registry.js";
import { mountApiRoutes } from "./routes/index.js";
import type { SecretProvider } from "./secrets.js";
import { EncryptedFileSecretProvider } from "./secrets.js";
import type { InitializedStorage } from "./storage.js";
import { SubscriptionUsageService } from "./usage/subscription-usage-service.js";

export { isWebSocketAuthorized } from "./http/auth-middleware.js";

export const version = "0.0.0";

export interface OrchestratorState {
  daemonId: string;
  startedAt: string;
  host: string;
  port: number;
  storage: InitializedStorage;
  events: EventBus;
  registry: RuntimeRegistry;
  index: IndexStore;
  secrets: SecretProvider;
  auth: AuthManager;
  oauthFlows: OAuthFlowManager;
  subscriptionUsage: SubscriptionUsageService;
}

export function createOrchestratorState(
  storage: InitializedStorage,
  host: string,
  port: number,
): OrchestratorState {
  const index = new IndexStore(storage.paths.sqlitePath);
  index.initialize();
  const events = new EventBus(storage.paths.home, index);
  const secrets = new EncryptedFileSecretProvider(storage.paths.home);
  const auth = new AuthManager(secrets);
  const oauthFlows = new OAuthFlowManager(auth, events);
  const subscriptionUsage = new SubscriptionUsageService({
    auth,
    events,
    cacheDir: join(storage.paths.home, "cache", "usage"),
  });
  return {
    daemonId: createId("daemon"),
    startedAt: new Date().toISOString(),
    host,
    port,
    storage,
    events,
    registry: new RuntimeRegistry(
      storage,
      events,
      index,
      auth,
      subscriptionUsage,
    ),
    index,
    secrets,
    auth,
    oauthFlows,
    subscriptionUsage,
  };
}

export function toDaemonFile(state: OrchestratorState): DaemonFile {
  return {
    daemonId: state.daemonId,
    pid: process.pid,
    host: state.host,
    port: state.port,
    url: `http://${state.host}:${state.port}`,
    startedAt: state.startedAt,
    dataDir: state.storage.paths.home,
    version,
  };
}

export function statusResponse(state: OrchestratorState): StatusResponse {
  return {
    daemonId: state.daemonId,
    version,
    startedAt: state.startedAt,
    dataDir: state.storage.paths.home,
    storage: {
      home: state.storage.paths.home,
      sqlitePath: state.storage.paths.sqlitePath,
      indexHealthy: state.index.isHealthy,
    },
  };
}

export function createApp(state: OrchestratorState): Hono {
  const app = new Hono();

  app.use("/api/*", createApiAuthMiddleware(state.storage.localToken));
  mountApiRoutes(app, state);

  app.get("*", async (c) =>
    serveStatic(
      new URL(c.req.url).pathname,
      state,
      getConnInfo(c).remote.address,
    ),
  );

  return app;
}
