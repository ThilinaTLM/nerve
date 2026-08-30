import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
} from "../method-handler-registry.js";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";

type TaskMethodContext = ServerAdapterContexts["protocol"]["tasks"];
const defineTaskMethodHandlers =
  defineWorkbenchMethodHandlersFor<TaskMethodContext>();

export const taskMethodHandlers: WorkbenchMethodHandlerMapFor<TaskMethodContext> =
  defineTaskMethodHandlers({
    "task.list": (state) => ({ tasks: state.tasks.listTasks() }),
    "task.start": async (state, params) => ({
      task: await state.tasks.startTask(params),
    }),
    "task.launchDefinition": (state, params) =>
      state.taskDefinitionOperations.launch(
        params.definitionId,
        params.terminateListeners,
      ),
    "task.get": (state, params) => ({
      task: state.tasks.getTask(params.taskId),
    }),
    "task.cancel": async (state, params) => {
      state.tasks.getTask(params.taskId);
      return {
        task: await state.tasks.cancelTask(params.taskId, params),
      };
    },
    "task.restart": async (state, params) => {
      state.tasks.getTask(params.taskId);
      return {
        task: await state.tasks.restartTask(params.taskId, {
          confirmUnverifiedReplacement:
            params.confirmUnverifiedReplacement ?? false,
        }),
      };
    },
    "task.prune": async (state) => ({
      removed: await state.tasks.pruneTasks(),
    }),
    "task.delete": async (state, params) => {
      state.tasks.getTask(params.taskId);
      await state.tasks.removeTask(params.taskId);
      return { removed: true };
    },
    "task.logs": (state, params) => {
      const { taskId, ...query } = params;
      return state.tasks.queryLogs(taskId, query);
    },
  });
