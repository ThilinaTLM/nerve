import { defineWorkbenchMethodHandlersFor } from "../method-handler-registry.js";
import type { ServerAdapterContexts } from "../../contexts.js";

type Context = ServerAdapterContexts["protocol"]["platform"];
const define = defineWorkbenchMethodHandlersFor<Context>();

// Settings → MCP servers. Protocol methods of the signed-in user's app connection: the agent
// reaches MCP through the `mcp` namespace of quick_script only, and has no way to save, approve,
// store a secret or test a server.
export const mcpMethodHandlers = define({
  "mcp.servers.list": (state, { target }) => state.mcp.list(target),
  "mcp.servers.save": (state, input) => state.mcp.save(input),
  "mcp.servers.remove": (state, input) => state.mcp.remove(input),
  "mcp.servers.test": (state, input) => state.mcp.test(input),
  "mcp.servers.disconnect": (state, input) => state.mcp.disconnect(input),
  "mcp.servers.review": (state, input) => state.mcp.review(input),
});
