import { defineOperation } from "../../operations/definition.js";
import {
  mcpDisconnectResultSchema,
  mcpNamedRequestSchema,
  mcpRemoveResultSchema,
  mcpReviewResultSchema,
  mcpSaveRequestSchema,
  mcpSaveResultSchema,
  mcpServersListResultSchema,
  mcpTargetSchema,
  mcpTestResultSchema,
} from "./schemas.js";
import { z } from "zod";

const host = ["workbench_server"] as const;

/**
 * Settings → MCP servers. User-UI only: the agent reaches MCP through the `mcp` namespace of
 * quick_script and has no operation like these (it cannot approve, save secrets or test).
 */
export const mcpOperationDefinitions = [
  defineOperation(
    "mcp.servers.list",
    z.strictObject({ target: mcpTargetSchema }),
    mcpServersListResultSchema,
    "read",
    host,
    "operation.mcp.servers.list",
  ),
  defineOperation(
    "mcp.servers.save",
    mcpSaveRequestSchema,
    mcpSaveResultSchema,
    "mutation",
    host,
    "operation.mcp.servers.save",
  ),
  defineOperation(
    "mcp.servers.remove",
    mcpNamedRequestSchema,
    mcpRemoveResultSchema,
    "mutation",
    host,
    "operation.mcp.servers.remove",
  ),
  defineOperation(
    "mcp.servers.test",
    mcpNamedRequestSchema,
    mcpTestResultSchema,
    "mutation",
    host,
    "operation.mcp.servers.test",
  ),
  defineOperation(
    "mcp.servers.disconnect",
    mcpNamedRequestSchema,
    mcpDisconnectResultSchema,
    "mutation",
    host,
    "operation.mcp.servers.disconnect",
  ),
  defineOperation(
    "mcp.servers.review",
    mcpNamedRequestSchema,
    mcpReviewResultSchema,
    "read",
    host,
    "operation.mcp.servers.review",
  ),
] as const;
