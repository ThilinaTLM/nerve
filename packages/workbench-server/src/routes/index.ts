import type { Hono } from "hono";
import type { WorkbenchState } from "../app/workbench-state.js";
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

export function mountApiRoutes(app: Hono, state: WorkbenchState): void {
  app.route("/api", createStatusRoutes(state));
  app.route("/api", createSettingsRoutes(state));
  app.route("/api", createAuthRoutes(state));
  app.route("/api", createProtocolRoutes(state));
  app.route("/api", createTranscriptionRoutes(state));
  if (state.applicationLogsEnabled) {
    app.route("/api", createLogRoutes(state));
  } else {
    app.all("/api/logs", (c) => c.notFound());
    app.all("/api/logs/*", (c) => c.notFound());
  }
  app.route("/api", createTaskLogRoutes(state));
  app.route("/api", createFilesystemContentRoutes(state));
  app.route("/api/projects", createProjectAssetRoutes(state));
  app.route("/api", createConversationExportRoutes(state));
  app.route("/api", createAgentArtifactRoutes(state));
}
