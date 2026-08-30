import { handleScratchNoteMethod } from "../scratch-note-method-handler.js";
import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
} from "../method-handler-registry.js";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";

type ProjectMethodContext = ServerAdapterContexts["protocol"]["projects"];
const defineProjectMethodHandlers =
  defineWorkbenchMethodHandlersFor<ProjectMethodContext>();

export const projectMethodHandlers: WorkbenchMethodHandlerMapFor<ProjectMethodContext> =
  defineProjectMethodHandlers({
    "project.create": async (state, params) => ({
      project: await state.projectLifecycle.createProject(params),
    }),
    "project.list": (state) => ({
      projects: state.projectLifecycle.listProjects(),
    }),
    "project.get": (state, params) => ({
      project: state.projectLifecycle.getProject(params.projectId),
    }),
    "project.permissions.get": async (state, params) => ({
      permissions: await state.permissionExceptions.project(params.projectId),
    }),
    "project.permissions.update": async (state, params) => ({
      permissions: await state.permissionExceptions.replaceProject(
        params.projectId,
        params.permissions,
      ),
    }),
    "project.permissionPolicy.get": async (state, params) => ({
      configuration: await permissionPolicyConfiguration(state, params),
    }),
    "project.permissionOverlay.update": async (state, params) => ({
      overlay: await updatePermissionOverlay(state, params),
    }),
    "project.permissionTrust.update": async (state, params) => ({
      trust: await updateProjectPermissionTrust(state, params),
    }),
    "project.openEditor": (state, params) =>
      state.editors.openProject(params.projectId, params),
    "project.openTerminal": (state, params) =>
      state.terminal.openProject(params.projectId, params),
    "project.conversations.prune": (state, params) =>
      state.pruneConversations.pruneProjectConversations(
        params.projectId,
        params,
      ),
    "project.delete": async (state, params) => {
      await state.projectLifecycle.removeProject(params.projectId);
      state.fileCompletions.dispose(params.projectId);
      return { ok: true };
    },
    "taskDefinition.list": async (state, params) => ({
      definitions: await state.taskDefinitions.list(projectId(params)),
    }),
    "taskDefinition.create": async (state, params) => ({
      definition: await state.taskDefinitionOperations.create(
        projectId(params),
        params as never,
      ),
    }),
    "taskDefinition.update": async (state, params) => ({
      definition: await state.taskDefinitions.update(
        projectId(params),
        params.definitionId,
        params as never,
      ),
    }),
    "taskDefinition.delete": async (state, params) => {
      await state.taskDefinitions.remove(
        projectId(params),
        params.definitionId,
      );
      return { ok: true };
    },
    "scratchNote.list": (state, params) =>
      handleScratchNoteMethod(state, "scratchNote.list", params),
    "scratchNote.create": (state, params) =>
      handleScratchNoteMethod(state, "scratchNote.create", params),
    "scratchNote.update": (state, params) =>
      handleScratchNoteMethod(state, "scratchNote.update", params),
    "scratchNote.delete": (state, params) =>
      handleScratchNoteMethod(state, "scratchNote.delete", params),
    "promptSuggestion.listForProject": (state, params) =>
      state.promptSuggestions.listForProject(params.projectId, {
        conversationId: params.conversationId,
        agentId: params.agentId,
      }),
    "promptSuggestion.statuses.list": async (state, params) => ({
      statuses: await state.promptSuggestions.listStatuses(params?.projectId),
    }),
    "promptSuggestion.trust.update": async (state, params) => {
      await state.promptSuggestions.updateTrust(params);
      return { ok: true };
    },
    "promptSuggestion.enabled.update": async (state, params) => {
      await state.promptSuggestions.updateEnabled(params);
      return { ok: true };
    },
    "promptSuggestion.create": async (state, params) => ({
      suggestion: await state.promptSuggestions.create(params),
    }),
  });

function projectId(params: { projectId: string }): string {
  return params.projectId;
}

function permissionPolicyConfiguration(
  state: ProjectMethodContext,
  params: { projectId: string; conversationId?: string },
) {
  state.projectLifecycle.getProject(params.projectId);
  return state.permissionPolicy.configuration(
    params.projectId,
    params.conversationId,
  );
}

function updatePermissionOverlay(
  state: ProjectMethodContext,
  params: {
    projectId: string;
    conversationId?: string;
    origin: "user" | "project" | "conversation";
    overlay: Parameters<
      ProjectMethodContext["permissionPolicy"]["replaceOverlay"]
    >[1];
  },
) {
  state.projectLifecycle.getProject(params.projectId);
  return state.permissionPolicy.replaceOverlay(
    params.origin,
    params.overlay,
    params.origin === "project"
      ? params.projectId
      : params.origin === "conversation"
        ? params.conversationId
        : undefined,
  );
}

async function updateProjectPermissionTrust(
  state: ProjectMethodContext,
  params: { projectId: string; trusted: boolean },
) {
  state.projectLifecycle.getProject(params.projectId);
  if (params.trusted)
    return state.permissionPolicy.trustProject(params.projectId);
  await state.permissionPolicy.revokeProjectTrust(params.projectId);
  return state.permissionPolicy.projectTrust(params.projectId);
}
