import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
} from "../method-handler-registry.js";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";

type LaunchMethodContext = ServerAdapterContexts["protocol"]["launches"];
const defineLaunchMethodHandlers =
  defineWorkbenchMethodHandlersFor<LaunchMethodContext>();

export const launchMethodHandlers: WorkbenchMethodHandlerMapFor<LaunchMethodContext> =
  defineLaunchMethodHandlers({
    "launch.list": (state) => ({ launches: state.launches.listLaunches() }),
    "launch.start": async (state, params) => ({
      launch: await state.launches.start(params),
    }),
    "launch.startDefinition": (state, params) =>
      state.launchDefinitionOperations.launch(
        params.definitionId,
        params.terminateListeners,
      ),
    "launch.get": async (state, params) => ({
      launch: await state.launches.require(params.launchId),
    }),
    "launch.cancel": async (state, params) => {
      await state.launches.require(params.launchId);
      return {
        launch: await state.launches.cancel(params.launchId, params),
      };
    },
    "launch.restart": async (state, params) => {
      await state.launches.require(params.launchId);
      return {
        launch: await state.launches.restart(params.launchId),
      };
    },
    "launch.prune": async (state) => ({
      removed: await state.launches.prune(),
    }),
    "launch.delete": async (state, params) => {
      await state.launches.require(params.launchId);
      await state.launches.delete(params.launchId);
      return { removed: true };
    },
    "launch.logs": (state, params) => {
      const { launchId, ...query } = params;
      return state.launches.queryLogs(launchId, query);
    },
  });
