import { handleScratchNoteMethod } from "../scratch-note-method-handler.js";
import { defineWorkbenchMethodHandlers } from "../method-handler-registry.js";

export const projectTaskMethodHandlers = defineWorkbenchMethodHandlers({
  "project.create": async (state, params) => ({
    project: await state.registry.createProject(params),
  }),
  "project.list": (state) => ({ projects: state.registry.listProjects() }),
  "project.get": (state, params) => ({
    project: state.registry.getProject(params.projectId),
  }),
  "project.openEditor": (state, params) =>
    state.registry.openProjectInEditor(params.projectId, params),
  "project.conversations.prune": (state, params) =>
    state.registry.pruneProjectConversations(params.projectId, params),
  "project.delete": async (state, params) => {
    await state.registry.removeProject(params.projectId);
    return { ok: true };
  },
  "pinnedCommand.list": async (state, params) => ({
    commands: await state.registry.listPinnedCommands(projectId(params)),
  }),
  "pinnedCommand.create": async (state, params) => ({
    command: await state.registry.createPinnedCommand(
      projectId(params),
      params as never,
    ),
  }),
  "pinnedCommand.update": async (state, params) => ({
    command: await state.registry.updatePinnedCommand(
      projectId(params),
      params.commandId,
      params as never,
    ),
  }),
  "pinnedCommand.delete": async (state, params) => {
    await state.registry.removePinnedCommand(
      projectId(params),
      params.commandId,
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
    state.registry.promptSuggestions.listForProject(params.projectId, {
      conversationId: params.conversationId,
      agentId: params.agentId,
    }),
  "promptSuggestion.statuses.list": async (state, params) => ({
    statuses: await state.registry.promptSuggestions.listStatuses(
      params?.projectId,
    ),
  }),
  "promptSuggestion.trust.update": async (state, params) => {
    await state.registry.promptSuggestions.updateTrust(params);
    return { ok: true };
  },
  "task.list": (state) => ({ tasks: state.registry.listTasks() }),
  "task.start": async (state, params) => ({
    task: await state.registry.startTask(params),
  }),
  "task.get": (state, params) => ({
    task: state.registry.getTask(params.taskId),
  }),
  "task.cancel": async (state, params) => {
    state.registry.getTask(params.taskId);
    return {
      task: await state.registry.cancelTask(params.taskId, params),
    };
  },
  "task.restart": async (state, params) => {
    state.registry.getTask(params.taskId);
    return { task: await state.registry.restartTask(params.taskId) };
  },
  "task.prune": async (state) => ({
    removed: await state.registry.pruneTasks(),
  }),
  "task.delete": async (state, params) => {
    state.registry.getTask(params.taskId);
    await state.registry.removeTask(params.taskId);
    return { removed: true };
  },
  "task.logs": (state, params) => {
    const { taskId, ...query } = params;
    return state.registry.queryTaskLogs(taskId, query);
  },
  "worker.list": (state) => ({ workers: state.registry.listWorkers() }),
  "worker.get": (state, params) => ({
    worker: state.registry.getWorker(params.workerId),
  }),
});

function projectId(
  params: { projectId: string } | { sandboxId: string },
): string {
  return (params as { projectId: string }).projectId;
}
