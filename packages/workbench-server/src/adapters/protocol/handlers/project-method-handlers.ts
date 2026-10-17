import {
  createLaunchDefinitionRequestSchema,
  updateLaunchDefinitionRequestSchema,
} from "@nervekit/contracts/launch-definitions";
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
    "promptSuggestion.listForProject": (state, params) =>
      state.promptSuggestions.listForProject(params.projectId, params),
    "promptSuggestion.statuses.list": async (state, params) => ({
      statuses: await state.promptSuggestions.listStatuses(params?.projectId),
    }),
    "promptSuggestion.create": async (state, params) => ({
      suggestion: await state.promptSuggestions.create(params),
    }),
    "promptSuggestion.enabled.update": async (state, params) => {
      await state.promptSuggestions.updateEnabled(params);
      return { ok: true };
    },
    "promptSuggestion.trust.update": async (state, params) => {
      await state.promptSuggestions.updateTrust(params);
      return { ok: true };
    },
    "subagentProfiles.list": async (state, params) => ({
      profiles: await state.subagentProfiles.list(
        params?.projectId,
        params?.conversationId,
      ),
    }),
    "subagentProfiles.preview": (state, params) =>
      state.subagentProfiles.preview(params),
    "subagentProfiles.replaceConversation": (state, params) =>
      state.subagentProfiles.replaceConversation(params),
    "subagentProfiles.configuration": (state, params) =>
      state.subagentProfiles.configuration(params),
    "subagentProfiles.update": (state, params) =>
      state.subagentProfiles.update(params),
    "subagentProfiles.reset": (state, params) =>
      state.subagentProfiles.reset(params),
    "subagentProfiles.trust": (state, params) =>
      state.subagentProfiles.trust(params.projectId, params.digest),
    "project.openEditor": (state, params) =>
      state.editors.openProject(params.projectId, params),
    "project.openTerminal": (state, params) =>
      state.terminal.openProject(params.projectId, params),
    "launchDefinition.list": async (state, params) => ({
      catalog: await state.launchDefinitions.catalog(params.projectId),
    }),
    "launchDefinition.create": (state, params) =>
      state.launchDefinitionOperations.create(
        params.projectId,
        createLaunchDefinitionRequestSchema.parse(params),
        params.expectedRevision,
      ),
    "launchDefinition.update": (state, params) =>
      state.launchDefinitions.update(
        params.projectId,
        params.definitionId,
        updateLaunchDefinitionRequestSchema.parse(params),
        params.expectedRevision,
      ),
    "launchDefinition.delete": (state, params) =>
      state.launchDefinitions.remove(
        params.projectId,
        params.definitionId,
        params.expectedRevision,
      ),
    "launchFolder.create": (state, params) =>
      state.launchDefinitions.createFolder(
        params.projectId,
        {
          ...params,
          parentFolderId: params.parentFolderId ?? null,
          beforeSibling: params.beforeSibling ?? null,
        },
        params.expectedRevision,
      ),
    "launchFolder.rename": (state, params) =>
      state.launchDefinitions.renameFolder(
        params.projectId,
        params.folderId,
        params.label,
        params.expectedRevision,
      ),
    "launchFolder.delete": (state, params) =>
      state.launchDefinitions.deleteFolder(
        params.projectId,
        params.folderId,
        params.expectedRevision,
      ),
    "launchCatalog.move": (state, params) =>
      state.launchDefinitions.move(
        params.projectId,
        params,
        params.expectedRevision,
      ),
    "scratchNote.list": (state, params) =>
      handleScratchNoteMethod(state, "scratchNote.list", params),
    "scratchNote.create": (state, params) =>
      handleScratchNoteMethod(state, "scratchNote.create", params),
    "scratchNote.update": (state, params) =>
      handleScratchNoteMethod(state, "scratchNote.update", params),
    "scratchNote.delete": (state, params) =>
      handleScratchNoteMethod(state, "scratchNote.delete", params),
  });
