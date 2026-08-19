import type { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { createAgentRoutes } from "./agent-routes.js";
import { createAuthRoutes } from "./auth-routes.js";
import { createCompletionRoutes } from "./completion-routes.js";
import { createConversationRoutes } from "./conversation-routes.js";
import { createFilesystemRoutes } from "./filesystem-routes.js";
import { createGitRoutes } from "./git-routes.js";
import { createLogRoutes } from "./log-routes.js";
import { createModelRoutes } from "./model-routes.js";
import { createProjectRoutes } from "./project-routes.js";
import { createPromptSuggestionRoutes } from "./prompt-suggestion-routes.js";
import { createProtocolRoutes } from "./protocol-routes.js";
import { createProviderCatalogRoutes } from "./provider-catalog-routes.js";
import { createSettingsRoutes } from "./settings-routes.js";
import { createStatusRoutes } from "./status-routes.js";
import { createStorageRoutes } from "./storage-routes.js";
import { createTaskRoutes } from "./task-routes.js";
import { createToolRoutes } from "./tool-routes.js";
import { createTranscriptionRoutes } from "./transcription-routes.js";
import { createWorkspaceRoutes } from "./workspace-routes.js";

export function mountApiRoutes(app: Hono, state: OrchestratorState): void {
  app.route("/api", createStatusRoutes(state));
  app.route("/api", createSettingsRoutes(state));
  app.route("/api", createAuthRoutes(state));
  app.route("/api", createProviderCatalogRoutes(state));
  app.route("/api", createProtocolRoutes(state));

  app.route("/api", createPromptSuggestionRoutes(state));
  app.route("/api", createStorageRoutes(state));
  app.route("/api", createModelRoutes(state));
  app.route("/api", createToolRoutes(state));
  app.route("/api", createTranscriptionRoutes(state));
  app.route("/api", createWorkspaceRoutes(state));

  if (state.applicationLogsEnabled) {
    app.route("/api", createLogRoutes(state));
  } else {
    app.all("/api/logs", (c) => c.notFound());
    app.all("/api/logs/*", (c) => c.notFound());
  }
  app.route("/api", createTaskRoutes(state));
  app.route("/api", createCompletionRoutes(state));
  app.route("/api", createFilesystemRoutes(state));
  app.route("/api", createGitRoutes(state));
  app.route("/api/projects", createProjectRoutes(state));
  app.route("/api", createConversationRoutes(state));
  app.route("/api", createAgentRoutes(state));
}
