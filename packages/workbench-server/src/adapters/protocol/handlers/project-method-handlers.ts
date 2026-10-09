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
    "project.openEditor": (state, params) =>
      state.editors.openProject(params.projectId, params),
    "project.openTerminal": (state, params) =>
      state.terminal.openProject(params.projectId, params),
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
  });

function projectId(params: { projectId: string }): string {
  return params.projectId;
}
