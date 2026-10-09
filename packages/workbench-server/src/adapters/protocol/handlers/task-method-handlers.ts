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
    "launch.list": (state) => ({ tasks: state.launches.listLaunches() }),
    "launch.start": async (state, params) => ({
      task: await state.launches.start(params),
    }),
    "launch.launchDefinition": (state, params) =>
      state.taskDefinitionOperations.launch(
        params.definitionId,
        params.terminateListeners,
      ),
    "launch.get": async (state, params) => ({
      task: await state.launches.require(params.taskId),
    }),
    "launch.cancel": async (state, params) => {
      await state.launches.require(params.taskId);
      return {
        task: await state.launches.cancel(params.taskId, params),
      };
    },
    "launch.restart": async (state, params) => {
      await state.launches.require(params.taskId);
      return {
        task: await state.launches.restart(params.taskId),
      };
    },
    "launch.prune": async (state) => ({
      removed: await state.launches.prune(),
    }),
    "launch.delete": async (state, params) => {
      await state.launches.require(params.taskId);
      await state.launches.delete(params.taskId);
      return { removed: true };
    },
    "launch.logs": (state, params) => {
      const { taskId, ...query } = params;
      return state.launches.queryLogs(taskId, query);
    },
  });
