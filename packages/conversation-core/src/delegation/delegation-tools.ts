import { createId } from "@nervekit/contracts";
import type {
  ConversationEvent,
  ConversationSummary,
} from "@nervekit/contracts/core";
import { SUBAGENT_BATCH_LIMIT } from "@nervekit/contracts/subagents";
import type { z } from "zod";
import type {
  subagentPromptResultDetailsSchema,
  subagentStatusResultDetailsSchema,
  subagentStopResultDetailsSchema,
} from "@nervekit/contracts/tools";
import { toolDefinitionByName } from "@nervekit/tools/catalog";
import type { ConversationCore, ExecutionFinished } from "../core.js";
import type { CoreToolHandler } from "../tool-calls/core-tool.js";
import { finalAssistantText, inlineReport } from "./child-report.js";
import type { SubagentHost } from "./subagent-host.js";
import {
  backgroundLabel,
  backgroundLines,
  formatNamedStatus,
  formatStatusList,
  recentActivity,
  type ChildState,
  type ChildStatus,
} from "./subagent-status.js";

export type { SubagentHost } from "./subagent-host.js";

interface Assignment {
  name: string;
  profile?: string;
  prompt: string;
}
const HISTORY_WINDOW = 60;
const key = (name: string) => name.trim().toLowerCase();
const text = (value: unknown) => (typeof value === "string" ? value : "");
const completion = ["completed", "failed", "cancelled", "interrupted"];

function definition(name: string) {
  const result = toolDefinitionByName(name);
  if (!result) throw new Error(`Missing tool definition: ${name}`);
  return result;
}

export function createDelegationTools(
  core: ConversationCore,
  host: SubagentHost,
): CoreToolHandler[] {
  // Children stopped by `subagent_stop`: the tool result already reports it, so no notice.
  const stoppedByTool = new Set<string>();
  const children = (parentId: string) => core.getSnapshot(parentId).children;
  const findChild = (parentId: string, name: string) =>
    children(parentId).find((child) => key(child.title) === key(name));
  /** The profile is read from the creating call: its arguments name it per assignment. */
  const profileOf = (
    parentId: string,
    child: Pick<ConversationSummary, "title" | "parentToolCallId">,
  ) => {
    const args = child.parentToolCallId
      ? core.toolCallArguments(parentId, child.parentToolCallId)
      : null;
    const assignments = Array.isArray(args?.assignments)
      ? (args.assignments as Record<string, unknown>[])
      : [];
    const match = assignments.find(
      (assignment) => key(text(assignment?.name)) === key(child.title),
    );
    return text(match?.profile) || null;
  };
  const recent = (id: string): ConversationEvent[] =>
    core.getHistory(id, { limit: HISTORY_WINDOW }) as ConversationEvent[];
  const lastExecution = (id: string): ExecutionFinished | undefined => {
    for (const event of recent(id)) {
      if (
        event.type === "system_event" &&
        event.payload.subtype === "execution_state" &&
        completion.includes(event.payload.transition) &&
        "executionId" in event.payload
      )
        return {
          conversationId: id,
          executionId: event.payload.executionId,
          transition: event.payload
            .transition as ExecutionFinished["transition"],
          event,
        };
    }
    return undefined;
  };
  const failureMessage = (result: ExecutionFinished | undefined) =>
    result?.event.type === "system_event" &&
    result.event.payload.subtype === "execution_state"
      ? (result.event.payload.failure?.message ?? null)
      : null;
  const runningBash = (id: string) =>
    core.getSnapshot(id).asyncBash.filter((row) => row.status === "running");

  core.onExecutionFinished((result) => {
    const child = core.getSnapshot(result.conversationId);
    const parentId = child.conversation.parentConversationId;
    if (!parentId) return;
    if (result.transition === "cancelled") {
      // A lead's `subagent_stop` is reported by its own result. A stop cascading from
      // the lead pauses the lead first, and a notice would only grow its next turn.
      if (stoppedByTool.has(result.conversationId)) return;
      if (core.getSnapshot(parentId).conversation.paused) return;
    }
    const profile = profileOf(parentId, child.conversation);
    const head = `Sub-agent "${child.conversation.title}"${profile ? ` (${profile})` : ""}`;
    const background = runningBash(result.conversationId);
    const response = finalAssistantText(core, result);
    const body = response
      ? `\n${inlineReport(core, result.conversationId, result.executionId, response)}`
      : "";
    const now = Date.now();
    let first: string;
    if (result.transition === "cancelled")
      first = `${head} was stopped by the user.`;
    else if (result.transition === "failed")
      first = `${head} failed: ${failureMessage(result) ?? "unknown error"}`;
    else if (result.transition === "interrupted")
      first = `${head} interrupted.`;
    else if (background.length)
      first = [
        `${head} is waiting on ${backgroundLabel(background.length)} and accepts follow-ups:`,
        ...backgroundLines(background, now),
      ].join("\n");
    else first = `${head} completed.`;
    // The assignment this execution worked on: its first parent-sourced message.
    let assignmentId = result.executionId;
    for (const event of recent(result.conversationId)) {
      if (event.id === result.executionId) break;
      if (
        event.sequence < result.event.sequence &&
        event.type === "user_message" &&
        event.payload.source === "parent_conversation" &&
        event.inputId
      )
        assignmentId = event.inputId;
    }
    core.inputs.enqueueNotice({
      conversationId: parentId,
      inputId: `input_${result.executionId}`,
      subtype: "sub_conversation_event",
      producer: result.conversationId,
      text: `${first}${body}`,
      details: {
        childConversationId: result.conversationId,
        assignmentId,
        status: result.transition,
        assetIds: [],
      },
      wakeWhenIdle: true,
    });
  });

  const prompt: CoreToolHandler = {
    definition: definition("subagent_prompt"),
    async execute(call) {
      const parentId = call.conversationId;
      const args = call.arguments;
      const assignments = (Array.isArray(args.assignments)
        ? args.assignments
        : []) as unknown as Assignment[];
      const context = text(args.context).trim();
      const errors: string[] = [];
      if (!assignments.length || assignments.length > SUBAGENT_BATCH_LIMIT)
        errors.push(`assignments must contain 1–${SUBAGENT_BATCH_LIMIT} items`);
      const usable = await host.usableProfiles(parentId);
      const resolved = new Map<
        string,
        Awaited<ReturnType<SubagentHost["resolveProfile"]>>
      >();
      const seen = new Set<string>();
      const plan: { assignment: Assignment; existing?: ConversationSummary }[] =
        [];
      for (const [index, assignment] of assignments.entries()) {
        const name = text(assignment?.name).trim();
        const label = name || `assignment ${index + 1}`;
        if (!name) errors.push(`${label}: name is required`);
        if (!text(assignment?.prompt).trim())
          errors.push(`${label}: prompt is required`);
        if (name && seen.has(key(name)))
          errors.push(`${label}: duplicate name in this call`);
        seen.add(key(name));
        const existing = name ? findChild(parentId, name) : undefined;
        const profile = text(assignment?.profile);
        if (existing) {
          const current = profileOf(parentId, existing);
          if (profile && current && profile !== current)
            errors.push(
              `${label}: is a ${current} sub-agent; profile ${profile} does not match`,
            );
        } else if (!profile)
          errors.push(
            `${label}: profile is required for a new sub-agent (usable: ${usable.join(", ") || "none"})`,
          );
        else if (!resolved.has(profile))
          try {
            resolved.set(
              profile,
              await host.resolveProfile({ parentId, profile }),
            );
          } catch (error) {
            errors.push(
              `${label}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        plan.push({ assignment, existing });
      }
      if (errors.length) {
        const message = `subagent_prompt rejected; nothing was created or queued:
${errors.map((line) => `- ${line}`).join("\n")}`;
        throw Object.assign(new Error(message), {
          details: {
            assignments: assignments.map((assignment) => ({
              name: text(assignment?.name),
              ...(assignment?.profile ? { profile: assignment.profile } : {}),
              disposition: "rejected",
              reason: errors.join("; "),
            })),
          },
        });
      }
      const { conversationId, ...parentConfig } =
        core.getSnapshot(parentId).config;
      void conversationId;
      const projectId = core.getSnapshot(parentId).conversation.projectId;
      const lines: string[] = [];
      const details: z.infer<typeof subagentPromptResultDetailsSchema> = {
        assignments: [],
      };
      for (const [index, { assignment, existing }] of plan.entries()) {
        try {
          const message = context
            ? `${context}\n\n${assignment.prompt}`
            : assignment.prompt;
          const submit = (childId: string) =>
            core.submitInput({
              conversationId: childId,
              inputId: createId("input"),
              source: "parent_conversation",
              senderConversationId: parentId,
              text: message,
              wakeWhenIdle: true,
            });
          if (existing) {
            const state = childState(existing, runningBash(existing.id).length);
            submit(existing.id);
            if (existing.paused) core.resume(existing.id);
            details.assignments!.push({
              name: assignment.name,
              profile: profileOf(parentId, existing) ?? undefined,
              disposition: "follow_up",
              agentId: existing.id,
            });
            lines.push(
              `${assignment.name} (${profileOf(parentId, existing) ?? "unknown"}): follow-up queued (${existing.paused ? "resumed" : state})`,
            );
            continue;
          }
          const profile = resolved.get(text(assignment.profile))!;
          const overrides = Object.fromEntries(
            Object.entries(profile.config).filter(([, v]) => v !== undefined),
          );
          const child = await core.createConversation({
            projectId,
            parentConversationId: parentId,
            parentToolCallId: call.id,
            title: assignment.name.trim(),
            config: {
              ...parentConfig,
              systemPrompt: null,
              instructions: null,
              ...overrides,
              agentProfile: profile.name,
            },
          });
          await profile.initializeChild(child.conversation.id);
          submit(child.conversation.id);
          details.assignments!.push({
            name: assignment.name,
            profile: profile.name,
            disposition: "created",
            agentId: child.conversation.id,
          });
          lines.push(`${assignment.name} (${profile.name}): created`);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          details.assignments!.push(
            ...plan.slice(index).map(({ assignment }, remainingIndex) => ({
              name: assignment.name,
              profile: assignment.profile,
              disposition: "rejected" as const,
              reason:
                remainingIndex === 0
                  ? reason
                  : "Not queued because an earlier assignment failed.",
            })),
          );
          throw Object.assign(
            new Error(
              `${lines.length ? `${lines.join("\n")}\n` : ""}subagent_prompt rejected remaining assignments: ${reason}`,
            ),
            { details },
          );
        }
      }
      return {
        kind: "completed",
        result: { content: lines.join("\n"), details },
      };
    },
  };

  const childState = (
    child: ConversationSummary,
    background: number,
  ): ChildState => {
    if (child.status === "running" || child.status === "waiting")
      return child.status;
    if (child.paused) return "stopped";
    if (child.status === "failed" || child.status === "interrupted")
      return child.status;
    void background;
    return "idle";
  };
  const statusOf = async (
    parentId: string,
    child: ConversationSummary,
  ): Promise<ChildStatus> => {
    const [usage, snapshot] = await Promise.all([
      core.contextUsage(child.id),
      Promise.resolve(core.getSnapshot(child.id)),
    ]);
    const background = snapshot.asyncBash.filter(
      (row) => row.status === "running",
    );
    const events = recent(child.id);
    const state = childState(child, background.length);
    const start =
      state === "running"
        ? events.find(
            (event) =>
              event.type === "system_event" &&
              event.payload.subtype === "execution_state" &&
              event.payload.transition === "started",
          )
        : undefined;
    return {
      name: child.title,
      profile: profileOf(parentId, child),
      model: `${snapshot.config.model.provider}/${snapshot.config.model.modelId}`,
      state,
      background,
      context: usage,
      lastActivityAt: events[0]?.createdAt ?? null,
      runningSince: start?.createdAt ?? null,
    };
  };

  const status: CoreToolHandler = {
    definition: definition("subagent_status"),
    async execute(call) {
      const parentId = call.conversationId;
      const name = text(call.arguments.name).trim();
      const now = Date.now();
      let content: string;
      const details: z.infer<typeof subagentStatusResultDetailsSchema> = {
        agents: [],
      };
      const collect = async (child: ConversationSummary) => {
        const info = await statusOf(parentId, child);
        details.agents!.push({
          name: info.name,
          agentId: child.id,
          profile: info.profile ?? undefined,
          state: info.state,
          contextPercent:
            info.context.percent === null
              ? undefined
              : Math.min(100, Math.max(0, info.context.percent)),
          lastActivityAt: info.lastActivityAt ?? undefined,
        });
        return info;
      };
      if (!name) {
        const infos = [];
        for (const child of children(parentId))
          infos.push(await collect(child));
        content = formatStatusList(infos, now);
      } else {
        const child = findChild(parentId, name);
        if (!child) throw new Error(`Unknown sub-agent: ${name}`);
        const info = await collect(child);
        const last = lastExecution(child.id);
        const response = last ? finalAssistantText(core, last) : "";
        content = formatNamedStatus(
          {
            child: info,
            finalResponse: last
              ? inlineReport(core, child.id, last.executionId, response)
              : "",
            failure: failureMessage(last),
            activity: recentActivity(
              recent(child.id).reverse().slice(-HISTORY_WINDOW),
              core
                .getSnapshot(child.id)
                .toolCalls.filter((row) => row.origin === "model"),
              now,
            ),
          },
          now,
        );
      }
      return { kind: "completed", result: { content, details } };
    },
  };

  const stop: CoreToolHandler = {
    definition: definition("subagent_stop"),
    async execute(call) {
      const names = Array.isArray(call.arguments.names)
        ? (call.arguments.names as unknown[]).map(text)
        : [];
      if (!names.length) throw new Error("names is required");
      const lines: string[] = [];
      const details: z.infer<typeof subagentStopResultDetailsSchema> = {
        results: [],
      };
      for (const name of names) {
        const child = findChild(call.conversationId, name);
        if (!child) {
          details.results!.push({ name, outcome: "not_found" });
          lines.push(`${name}: not found`);
          continue;
        }
        const state = childState(child, 0);
        if (
          (state === "idle" || state === "stopped") &&
          !runningBash(child.id).length
        ) {
          details.results!.push({ name, outcome: "already_idle" });
          lines.push(`${child.title}: nothing to stop (${state})`);
          continue;
        }
        const started =
          child.status === "running"
            ? recent(child.id).find(
                (event) =>
                  event.type === "system_event" &&
                  event.payload.subtype === "execution_state" &&
                  event.payload.transition === "started",
              )
            : undefined;
        const runMs = started
          ? Math.max(0, Date.now() - Date.parse(started.createdAt))
          : undefined;
        stoppedByTool.add(child.id);
        try {
          await core.stop(child.id);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          details.results!.push({ name, outcome: "failed", runMs, reason });
          lines.push(`${child.title}: failed to stop: ${reason}`);
          continue;
        } finally {
          stoppedByTool.delete(child.id);
        }
        details.results!.push({ name, outcome: "stopped", runMs });
        lines.push(`${child.title}: stopped`);
      }
      return {
        kind: "completed",
        result: { content: lines.join("\n"), details },
      };
    },
  };
  return [prompt, status, stop];
}
