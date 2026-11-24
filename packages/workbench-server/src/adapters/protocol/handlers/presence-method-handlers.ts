import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
} from "../method-handler-registry.js";
import type { ServerAdapterContexts } from "../../contexts.js";

type PresenceMethodContext = ServerAdapterContexts["protocol"]["platform"];
const definePresenceMethodHandlers =
  defineWorkbenchMethodHandlersFor<PresenceMethodContext>();

/** Session-scoped: the report lives until the reporting session is disposed. */
export const presenceMethodHandlers: WorkbenchMethodHandlerMapFor<PresenceMethodContext> =
  definePresenceMethodHandlers({
    "access.presence.report": (state, params, invocation) => {
      if (!invocation.monitorOwner)
        throw new Error("Presence reports require a live protocol session");
      state.push.reportPresence(invocation.monitorOwner, params);
      return { ok: true };
    },
  });
