import type { Hono } from "hono";
import type { ServerRuntime } from "../../../app/runtime/server-runtime.js";
import { createAgentArtifactRoutes } from "./agent-artifact-routes.js";
import { createAuthRoutes } from "./auth-routes.js";
import { createConversationExportRoutes } from "./conversation-export-routes.js";
import { createFilesystemContentRoutes } from "./filesystem-content-routes.js";
import { createLogRoutes } from "./log-routes.js";
import { createProjectAssetRoutes } from "./project-asset-routes.js";
import { createProtocolRoutes } from "./protocol-routes.js";
import { createSettingsRoutes } from "./settings-routes.js";
import { createStatusRoutes } from "./status-routes.js";
import { createTaskLogRoutes } from "./task-log-routes.js";
import { createTranscriptionRoutes } from "./transcription-routes.js";

export function mountApiRoutes(app: Hono, state: ServerRuntime): void {
  const contexts = state.adapterContexts.http;
  app.route("/api", createStatusRoutes(contexts.status));
  app.route("/api", createSettingsRoutes(contexts.settings));
  app.route("/api", createAuthRoutes(contexts.auth));
  app.route("/api", createProtocolRoutes(contexts.protocol));
  app.route("/api", createTranscriptionRoutes(contexts.transcription));
  if (state.applicationLogsEnabled) {
    app.route("/api", createLogRoutes(contexts.logs));
  } else {
    app.all("/api/logs", (c) => c.notFound());
    app.all("/api/logs/*", (c) => c.notFound());
  }
  app.route("/api", createTaskLogRoutes(contexts.taskLogs));
  app.route("/api", createFilesystemContentRoutes(contexts.filesystem));
  app.route("/api/projects", createProjectAssetRoutes(contexts.projectAssets));
  app.route(
    "/api",
    createConversationExportRoutes(contexts.conversationExport),
  );
  app.route("/api", createAgentArtifactRoutes(contexts.agentArtifacts));
}
