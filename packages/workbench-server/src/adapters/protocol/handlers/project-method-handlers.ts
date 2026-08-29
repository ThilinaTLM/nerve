import { handleScratchNoteMethod } from "../scratch-note-method-handler.js";
import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
  type WorkbenchOperationContext,
} from "../method-handler-registry.js";

type ProjectMethodContext = Pick<WorkbenchOperationContext, "services">;
const defineProjectMethodHandlers =
  defineWorkbenchMethodHandlersFor<ProjectMethodContext>();

export const projectMethodHandlers: WorkbenchMethodHandlerMapFor<ProjectMethodContext> =
  defineProjectMethodHandlers({
    "project.create": async (state, params) => ({
      project: await state.services.projectLifecycle.createProject(params),
    }),
    "project.list": (state) => ({
      projects: state.services.projectLifecycle.listProjects(),
    }),
    "project.get": (state, params) => ({
      project: state.services.projectLifecycle.getProject(params.projectId),
    }),
    "project.permissions.get": async (state, params) => ({
      permissions: await state.services.permissionExceptions.project(
        params.projectId,
      ),
    }),
    "project.permissions.update": async (state, params) => ({
      permissions: await state.services.permissionExceptions.replaceProject(
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
      state.services.editors.openProject(params.projectId, params),
    "project.openTerminal": (state, params) =>
      state.services.terminal.openProject(params.projectId, params),
    "project.conversations.prune": (state, params) =>
      state.services.pruneConversations.pruneProjectConversations(
        params.projectId,
        params,
      ),
    "project.delete": async (state, params) => {
      await state.services.projectLifecycle.removeProject(params.projectId);
      state.services.fileCompletions.dispose(params.projectId);
      return { ok: true };
    },
    "taskDefinition.list": async (state, params) => ({
      definitions: await state.services.taskDefinitions.list(projectId(params)),
    }),
    "taskDefinition.create": async (state, params) => ({
      definition: await state.services.taskDefinitionOperations.create(
        projectId(params),
        params as never,
      ),
    }),
    "taskDefinition.update": async (state, params) => ({
      definition: await state.services.taskDefinitions.update(
        projectId(params),
        params.definitionId,
        params as never,
      ),
    }),
    "taskDefinition.delete": async (state, params) => {
      await state.services.taskDefinitions.remove(
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
      state.services.promptSuggestions.listForProject(params.projectId, {
        conversationId: params.conversationId,
        agentId: params.agentId,
      }),
    "promptSuggestion.statuses.list": async (state, params) => ({
      statuses: await state.services.promptSuggestions.listStatuses(
        params?.projectId,
      ),
    }),
    "promptSuggestion.trust.update": async (state, params) => {
      await state.services.promptSuggestions.updateTrust(params);
      return { ok: true };
    },
    "promptSuggestion.enabled.update": async (state, params) => {
      await state.services.promptSuggestions.updateEnabled(params);
      return { ok: true };
    },
    "promptSuggestion.create": async (state, params) => ({
      suggestion: await state.services.promptSuggestions.create(params),
    }),
  });

function projectId(params: { projectId: string }): string {
  return params.projectId;
}

function permissionPolicyConfiguration(
  state: ProjectMethodContext,
  params: { projectId: string; conversationId?: string },
) {
  state.services.projectLifecycle.getProject(params.projectId);
  return state.services.permissionPolicy.configuration(
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
      ProjectMethodContext["services"]["permissionPolicy"]["replaceOverlay"]
    >[1];
  },
) {
  state.services.projectLifecycle.getProject(params.projectId);
  return state.services.permissionPolicy.replaceOverlay(
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
  state.services.projectLifecycle.getProject(params.projectId);
  if (params.trusted)
    return state.services.permissionPolicy.trustProject(params.projectId);
  await state.services.permissionPolicy.revokeProjectTrust(params.projectId);
  return state.services.permissionPolicy.projectTrust(params.projectId);
}
