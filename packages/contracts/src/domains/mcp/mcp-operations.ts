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
    "none",
    host,
    "operation.mcp.servers.list",
  ),
  defineOperation(
    "mcp.servers.save",
    mcpSaveRequestSchema,
    mcpSaveResultSchema,
    "mutation",
    "none",
    host,
    "operation.mcp.servers.save",
  ),
  defineOperation(
    "mcp.servers.remove",
    mcpNamedRequestSchema,
    mcpRemoveResultSchema,
    "mutation",
    "none",
    host,
    "operation.mcp.servers.remove",
  ),
  defineOperation(
    "mcp.servers.test",
    mcpNamedRequestSchema,
    mcpTestResultSchema,
    "mutation",
    "none",
    host,
    "operation.mcp.servers.test",
  ),
  defineOperation(
    "mcp.servers.disconnect",
    mcpNamedRequestSchema,
    mcpDisconnectResultSchema,
    "mutation",
    "none",
    host,
    "operation.mcp.servers.disconnect",
  ),
  defineOperation(
    "mcp.servers.review",
    mcpNamedRequestSchema,
    mcpReviewResultSchema,
    "read",
    "none",
    host,
    "operation.mcp.servers.review",
  ),
] as const;
