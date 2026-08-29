import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
  type WorkbenchOperationContext,
} from "../method-handler-registry.js";

type TaskMethodContext = Pick<WorkbenchOperationContext, "services">;
const defineTaskMethodHandlers =
  defineWorkbenchMethodHandlersFor<TaskMethodContext>();

export const taskMethodHandlers: WorkbenchMethodHandlerMapFor<TaskMethodContext> =
  defineTaskMethodHandlers({
    "task.list": (state) => ({ tasks: state.services.tasks.listTasks() }),
    "task.start": async (state, params) => ({
      task: await state.services.tasks.startTask(params),
    }),
    "task.launchDefinition": (state, params) =>
      state.services.taskDefinitionOperations.launch(
        params.definitionId,
        params.terminateListeners,
      ),
    "task.get": (state, params) => ({
      task: state.services.tasks.getTask(params.taskId),
    }),
    "task.cancel": async (state, params) => {
      state.services.tasks.getTask(params.taskId);
      return {
        task: await state.services.tasks.cancelTask(params.taskId, params),
      };
    },
    "task.restart": async (state, params) => {
      state.services.tasks.getTask(params.taskId);
      return {
        task: await state.services.tasks.restartTask(params.taskId, {
          confirmUnverifiedReplacement:
            params.confirmUnverifiedReplacement ?? false,
        }),
      };
    },
    "task.prune": async (state) => ({
      removed: await state.services.tasks.pruneTasks(),
    }),
    "task.delete": async (state, params) => {
      state.services.tasks.getTask(params.taskId);
      await state.services.tasks.removeTask(params.taskId);
      return { removed: true };
    },
    "task.logs": (state, params) => {
      const { taskId, ...query } = params;
      return state.services.tasks.queryLogs(taskId, query);
    },
  });
