import type {
  ProjectRecord,
  StartTaskRequest,
  TaskDefinition,
  TaskRecord,
} from "$lib/api";
import type {
  CreateTaskDefinitionRequest,
  UpdateTaskDefinitionRequest,
} from "@nervekit/contracts";
import { writeClipboardText } from "$lib/core/clipboard";
import { onEvent } from "$lib/core/events/event-bus";
import { notify } from "$lib/features/notifications/notify.svelte";
import {
  getTaskLogs,
  launchTaskDefinition,
} from "$lib/features/tasks/api/tasks.api";
import { taskState } from "$lib/features/tasks/state/task-state.svelte";
import { loadWorkspaceState } from "$lib/features/workspace/state/workspace-actions.svelte";
import {
  createTaskDefinition,
  deleteTaskDefinition,
  getTaskDefinitions,
  updateTaskDefinition,
} from "$lib/api";
import {
  createTaskPanelActions,
  disabledCapability,
  enabledCapability,
  normalizeTaskDefinition,
  type TaskPanelActions,
  type TaskPanelDefinition,
  type TaskPanelModel,
} from "@nervekit/workbench-ui";

export type WorkbenchTaskPanelHostActions = {
  readonly openTaskOutput?: (id: string) => void;
  readonly cancelTask?: (id: string) => void;
  readonly restartTask?: (id: string) => void;
  readonly removeTask?: (id: string) => void;
  readonly pruneTasks?: () => void;
  readonly runCommand?: (input: {
    projectId: string;
    cwd: string;
    command: string;
    name?: string;
  }) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWorkbenchTaskPanelAdapter(
  activeProject: () => ProjectRecord | undefined,
  tasks: () => readonly TaskRecord[],
  selectedTask: () => TaskRecord | undefined,
  hostActions: WorkbenchTaskPanelHostActions,
): { readonly model: TaskPanelModel; readonly actions: TaskPanelActions } {
  let definitions = $state<TaskDefinition[]>([]);
  let loadingDefinitions = $state(false);
  let runningDefinitionId = $state<string | undefined>(undefined);
  let lastLoadedProjectId = $state<string | undefined>(undefined);

  const unavailable = (message: string) => disabledCapability(message);
  const adapter = {
    get model(): TaskPanelModel {
      const project = activeProject();
      const noProject = unavailable("Select a project to manage tasks.");
      const noRunner = unavailable(
        "Task execution is unavailable in this host.",
      );
      const noAction = unavailable(
        "This task operation is unavailable in this host.",
      );
      const action = project ? enabledCapability : noProject;
      return {
        availability: project
          ? { available: true }
          : {
              available: false,
              message: "Select a project to manage its tasks.",
            },
        tasks: tasks(),
        selectedTask: selectedTask(),
        selectedLogs: taskState.taskLogs,
        logsLoading: false,
        definitions: definitions.map(normalizeTaskDefinition),
        defaultCwd: project?.dir ?? "",
        definitionsLoading: loadingDefinitions,
        runningDefinitionId,
        capabilities: {
          start:
            project && hostActions.runCommand ? enabledCapability : noRunner,
          cancel:
            project && hostActions.cancelTask ? enabledCapability : noAction,
          restart:
            project && hostActions.restartTask ? enabledCapability : noAction,
          remove:
            project && hostActions.removeTask ? enabledCapability : noAction,
          prune:
            project && hostActions.pruneTasks ? enabledCapability : noAction,
          copy: enabledCapability,
          logs:
            project && hostActions.openTaskOutput
              ? enabledCapability
              : noAction,
          manageDefinitions: action,
        },
      };
    },
    actions: undefined as unknown as TaskPanelActions,
  };

  function original(
    definition: TaskPanelDefinition,
  ): TaskDefinition | undefined {
    return definitions.find((item) => item.id === definition.id);
  }

  const host: TaskPanelActions = {
    selectTask: (taskId) => {
      taskState.selectedTaskId = taskId;
    },
    openTaskOutput: (taskId) => hostActions.openTaskOutput?.(taskId),
    startTask: (request: StartTaskRequest) => {
      const project = activeProject();
      if (!project) return;
      hostActions.runCommand?.({
        projectId: project.id,
        cwd: request.cwd,
        command: request.command,
        name: request.name,
      });
    },
    runDefinition: async (definition) => {
      const project = activeProject();
      if (!project) return;
      runningDefinitionId = definition.id;
      try {
        const result = await launchTaskDefinition(definition.id);
        await loadWorkspaceState();
        notify.success(
          result.disposition === "focused_existing"
            ? "Task is already running"
            : "Task started",
          { description: definition.label ?? definition.command },
        );
      } catch (error) {
        notify.error(`Could not run task: ${errorMessage(error)}`);
      } finally {
        runningDefinitionId = undefined;
      }
    },
    cancelTask: (id) => hostActions.cancelTask?.(id),
    restartTask: (id) => hostActions.restartTask?.(id),
    removeTask: (id) => hostActions.removeTask?.(id),
    pruneTasks: () => hostActions.pruneTasks?.(),
    copyText: async (text) => {
      try {
        await writeClipboardText(text);
        notify.success("Copied to clipboard");
      } catch {
        notify.error("Could not copy to clipboard");
      }
    },
    createDefinition: async (input: CreateTaskDefinitionRequest) => {
      const project = activeProject();
      if (!project) return;
      try {
        const created = await createTaskDefinition(project.id, {
          ...input,
          runPolicy: input.runPolicy ?? "single",
        });
        definitions = [...definitions, created];
        notify.success("Task saved");
      } catch (error) {
        notify.error(`Could not save task: ${errorMessage(error)}`);
        throw error;
      }
    },
    updateDefinition: async (
      definition,
      input: UpdateTaskDefinitionRequest,
    ) => {
      const project = activeProject();
      const item = original(definition);
      if (!project || !item) return;
      try {
        const updated = await updateTaskDefinition(project.id, item.id, {
          ...input,
          runPolicy: input.runPolicy ?? item.runPolicy,
        });
        definitions = definitions.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        );
        notify.success("Task updated");
      } catch (error) {
        notify.error(`Could not update task: ${errorMessage(error)}`);
        throw error;
      }
    },
    deleteDefinition: async (definition) => {
      const project = activeProject();
      const item = original(definition);
      if (!project || !item) return;
      try {
        await deleteTaskDefinition(project.id, item.id);
        definitions = definitions.filter(
          (candidate) => candidate.id !== item.id,
        );
        notify.success("Saved task deleted");
      } catch (error) {
        notify.error(`Could not remove saved task: ${errorMessage(error)}`);
        throw error;
      }
    },
    loadLogs: async (taskId, query) => {
      taskState.taskLogs = await getTaskLogs(taskId, query);
    },
  };
  adapter.actions = createTaskPanelActions(() => adapter.model, host);

  $effect(() => {
    const disposeCreated = onEvent("taskDefinition.created", (event) => {
      const definition = event.data?.definition as TaskDefinition | undefined;
      const projectId = activeProject()?.id;
      if (
        definition?.scope.kind === "project" &&
        definition.scope.projectId === projectId &&
        !definitions.some((item) => item.id === definition.id)
      )
        definitions = [...definitions, definition];
    });
    const disposeUpdated = onEvent("taskDefinition.updated", (event) => {
      const definition = event.data?.definition as TaskDefinition | undefined;
      if (!definition) return;
      definitions = definitions.map((item) =>
        item.id === definition.id ? definition : item,
      );
    });
    const disposeDeleted = onEvent("taskDefinition.deleted", (event) => {
      const definitionId = String(event.data?.definitionId ?? "");
      definitions = definitions.filter((item) => item.id !== definitionId);
    });
    return () => {
      disposeCreated();
      disposeUpdated();
      disposeDeleted();
    };
  });

  $effect(() => {
    const projectId = activeProject()?.id;
    if (projectId === lastLoadedProjectId) return;
    lastLoadedProjectId = projectId;
    definitions = [];
    if (!projectId) return;
    loadingDefinitions = true;
    void getTaskDefinitions(projectId)
      .then((loaded) => {
        if (activeProject()?.id === projectId) definitions = loaded;
      })
      .catch((error) =>
        notify.error(`Could not load task definitions: ${errorMessage(error)}`),
      )
      .finally(() => {
        if (activeProject()?.id === projectId) loadingDefinitions = false;
      });
  });

  return adapter;
}
