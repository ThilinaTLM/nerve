import { z } from "zod";
import {
  contentBlockIdSchema,
  liveMessageIdSchema,
  runIdSchema,
  turnIdSchema,
} from "../conversations/live-state.js";
import { PUBLIC_EVENT_MAX_STRING_CHARS } from "../../events/bounded-public-data.js";
import { definePublicEvent } from "../../events/definition.js";
import { modeSchema } from "../settings/settings.js";
import { agentSuspensionRecordSchema } from "../suspensions/suspension.js";
import { exploreReportSummarySchema } from "../tools/tool-results.js";
import { agentRecordSchema, agentStatusSchema } from "./agent.js";

const workbenchRoles = ["workbench_server"] as const;
const agentIdSchema = z.string().startsWith("agent_");
const transcriptIdentitySchema = z
  .object({
    conversationId: z.string().startsWith("conv_"),
    projectId: z.string().startsWith("proj_"),
    parentAgentId: agentIdSchema,
    childAgentId: agentIdSchema,
    runId: runIdSchema,
  })
  .strict();
const transcriptTurnSchema = transcriptIdentitySchema.extend({
  turnId: turnIdSchema,
});
const transcriptMessageSchema = transcriptTurnSchema.extend({
  liveMessageId: liveMessageIdSchema,
});
const transcriptContentSchema = transcriptMessageSchema.extend({
  contentBlockId: contentBlockIdSchema,
  contentIndex: z.number().int().nonnegative(),
  kind: z.enum(["text", "thinking"]),
});
const subagentTranscriptEvent = (name: string, schema: z.ZodType) =>
  definePublicEvent(name, schema, {
    allowedSourceRoles: workbenchRoles,
    scope: ["parentAgentId", "childAgentId", "runId"],
  });

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
  subagentTranscriptEvent(
    "agent.subagent_transcript.run.started",
    transcriptIdentitySchema.extend({ startedAt: z.string().datetime() }),
  ),
  subagentTranscriptEvent(
    "agent.subagent_transcript.turn.started",
    transcriptTurnSchema.extend({ ordinal: z.number().int().nonnegative() }),
  ),
  subagentTranscriptEvent(
    "agent.subagent_transcript.message.started",
    transcriptMessageSchema.extend({
      messageOrdinal: z.number().int().nonnegative(),
      startedAt: z.string().datetime(),
    }),
  ),
  subagentTranscriptEvent(
    "agent.subagent_transcript.content.delta",
    transcriptContentSchema.extend({
      offset: z.number().int().nonnegative(),
      delta: z.string().max(PUBLIC_EVENT_MAX_STRING_CHARS),
    }),
  ),
  subagentTranscriptEvent(
    "agent.subagent_transcript.content.done",
    transcriptContentSchema.extend({
      redacted: z.boolean().optional(),
    }),
  ),
  subagentTranscriptEvent(
    "agent.subagent_transcript.message.completed",
    transcriptMessageSchema.extend({ status: z.enum(["completed", "failed"]) }),
  ),
  subagentTranscriptEvent(
    "agent.subagent_transcript.turn.completed",
    transcriptTurnSchema.extend({ status: z.enum(["completed", "failed"]) }),
  ),
  subagentTranscriptEvent(
    "agent.subagent_transcript.run.completed",
    transcriptIdentitySchema.extend({
      status: z.enum(["completed", "failed", "aborted"]),
      completedAt: z.string().datetime(),
      message: z.string().max(PUBLIC_EVENT_MAX_STRING_CHARS).optional(),
    }),
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
