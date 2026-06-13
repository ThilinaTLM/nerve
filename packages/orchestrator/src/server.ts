import { join } from "node:path";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createId, type DaemonFile, type StatusResponse } from "@nerve/shared";
import { Hono } from "hono";
import { AuthManager } from "./auth.js";
import { CredentialKeyService } from "./credential-crypto.js";
import { createApiAuthMiddleware } from "./http/auth-middleware.js";
import {
  clearRequestContext,
  setRequestContext,
} from "./http/request-context.js";
import { serveStatic } from "./http/static-files.js";
import { EventBus } from "./infrastructure/events/index.js";
import { IndexStore } from "./infrastructure/index-store/index.js";
import type { InitializedStorage } from "./infrastructure/storage/index.js";
import { ApplicationLogger } from "./logging.js";
import { OAuthFlowManager } from "./oauth-flow.js";
import { RuntimeRegistry } from "./registry.js";
import { mountApiRoutes } from "./routes/index.js";
import type { SecretProvider } from "./secrets.js";
import { EncryptedFileSecretProvider } from "./secrets.js";
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
  logger: ApplicationLogger;
  registry: RuntimeRegistry;
  index: IndexStore;
  secrets: SecretProvider;
  auth: AuthManager;
  credentialKey: CredentialKeyService;
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
  const logger = new ApplicationLogger({
    dataDir: storage.paths.home,
    source: "orchestrator",
    component: "daemon",
    level: storage.settings.logging.level,
    retentionDays: storage.settings.logging.retentionDays,
    maxBufferedLogs: storage.settings.logging.maxBufferedLogs,
  });
  const secrets = new EncryptedFileSecretProvider(storage.paths.home);
  const auth = new AuthManager(secrets);
  const credentialKey = new CredentialKeyService();
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
    logger,
    registry: new RuntimeRegistry(
      storage,
      events,
      index,
      auth,
      subscriptionUsage,
      logger,
    ),
    index,
    secrets,
    auth,
    credentialKey,
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

  app.use("/api/*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? createId("log");
    const started = performance.now();
    const logger = state.logger.child({
      component: "http",
      requestId,
      context: {
        method: c.req.method,
        path: new URL(c.req.url).pathname,
      },
    });
    setRequestContext(c.req.raw, { requestId, logger });
    c.header("x-request-id", requestId);
    try {
      await next();
    } finally {
      const status = c.res.status;
      const durationMs = Math.round(performance.now() - started);
      const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
      await logger[level]("HTTP request completed", {
        durationMs,
        context: {
          status,
          method: c.req.method,
          path: new URL(c.req.url).pathname,
        },
      }).catch(() => undefined);
      clearRequestContext(c.req.raw);
    }
  });
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
