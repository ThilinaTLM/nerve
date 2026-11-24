import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";
import { mcpTargetSchema } from "./schemas.js";

export const mcpEventDefinitions = [
  /** An MCP file, an approval or a connection changed in a scope; open pages re-read `mcp.servers.list`. */
  definePublicEvent("mcp.changed", z.object({ scope: mcpTargetSchema }), {
    allowedSourceRoles: ["workbench_server"],
  }),
];
