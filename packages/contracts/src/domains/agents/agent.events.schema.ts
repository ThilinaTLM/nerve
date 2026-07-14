import { z } from "zod";
import { definePublicEvent } from "../events/event-definition.schema.js";
import { modeSchema } from "../settings/settings.schema.js";
import { agentSuspensionRecordSchema } from "../suspensions/suspension.schema.js";
import { exploreReportSummarySchema } from "../tools/tool-results.schema.js";
import { agentRecordSchema, agentStatusSchema } from "./agent.schema.js";

const workbenchRoles = ["workbench_server"] as const;
const agentIdSchema = z.string().startsWith("agent_");

export const agentEventDefinitions = [
  definePublicEvent(
    "agent.created",
    z.object({
      agent: agentRecordSchema,
      task: z.string().min(1).max(16_384).optional(),
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["agent.id"] },
  ),
  definePublicEvent(
    "agent.configured",
    z.object({ agent: agentRecordSchema }),
    { allowedSourceRoles: workbenchRoles, scope: ["agent.id"] },
  ),
  definePublicEvent(
    "agent.status_changed",
    z.object({
      agent: agentRecordSchema,
      agentId: agentIdSchema,
      status: agentStatusSchema,
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["agentId"] },
  ),
  definePublicEvent(
    "agent.mode_changed",
    z.object({
      agent: agentRecordSchema,
      previousMode: modeSchema,
      mode: modeSchema,
      reason: z.string().min(1).max(4_096),
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["agent.id"] },
  ),
  definePublicEvent(
    "agent.abort_requested",
    z.object({
      agentId: agentIdSchema,
      runId: z.string().startsWith("run_"),
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["agentId", "runId"] },
  ),
  ...["agent.suspension.created", "agent.suspension.updated"].map((name) =>
    definePublicEvent(
      name,
      z.object({ suspension: agentSuspensionRecordSchema }),
      { allowedSourceRoles: workbenchRoles, scope: ["suspension.id"] },
    ),
  ),
  definePublicEvent(
    "agent.explore_completed",
    z.object({
      parentAgentId: agentIdSchema,
      reports: z.array(exploreReportSummarySchema).max(64),
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["parentAgentId"] },
  ),
  definePublicEvent(
    "agent.subagent_started",
    z.object({
      parentAgentId: agentIdSchema,
      childAgentId: agentIdSchema,
      kind: z.string().min(1).max(128),
      task: z.string().min(1).max(16_384),
    }),
    {
      allowedSourceRoles: workbenchRoles,
      scope: ["parentAgentId", "childAgentId"],
    },
  ),
  definePublicEvent(
    "agent.subagent_completed",
    z.object({
      parentAgentId: agentIdSchema,
      childAgentId: agentIdSchema,
      kind: z.string().min(1).max(128),
      summary: z.string().max(16_384),
    }),
    {
      allowedSourceRoles: workbenchRoles,
      scope: ["parentAgentId", "childAgentId"],
    },
  ),
];
