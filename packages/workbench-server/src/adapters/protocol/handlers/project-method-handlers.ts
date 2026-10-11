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
      profiles: await state.subagentProfiles.list(params?.projectId),
    }),
    "subagentProfiles.save": async (state, params) => ({
      profile: await state.subagentProfiles.save(params),
    }),
    "subagentProfiles.delete": async (state, params) => {
      await state.subagentProfiles.delete(params);
      return { ok: true };
    },
    "subagentProfiles.setEnabled": async (state, params) => {
      await state.subagentProfiles.setEnabled(params.name, params.enabled);
      return { ok: true };
    },
    "subagentProfiles.trust": async (state, params) => ({
      profile: await state.subagentProfiles.trust(
        params.projectId,
        params.name,
        params.digest,
      ),
    }),
    "project.openEditor": (state, params) =>
      state.editors.openProject(params.projectId, params),
    "project.openTerminal": (state, params) =>
      state.terminal.openProject(params.projectId, params),
    "launchDefinition.list": async (state, params) => ({
      definitions: await state.launchDefinitions.list(projectId(params)),
    }),
    "launchDefinition.create": async (state, params) => ({
      definition: await state.launchDefinitionOperations.create(
        projectId(params),
        params as never,
      ),
    }),
    "launchDefinition.update": async (state, params) => ({
      definition: await state.launchDefinitions.update(
        projectId(params),
        params.definitionId,
        params as never,
      ),
    }),
    "launchDefinition.delete": async (state, params) => {
      await state.launchDefinitions.remove(
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
  });

function projectId(params: { projectId: string }): string {
  return params.projectId;
}
