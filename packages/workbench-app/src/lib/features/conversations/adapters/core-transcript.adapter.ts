import { asyncBashToolView } from "./core-async-bash-tool.adapter";
import { conversationCatalog } from "../state/conversation-catalog.svelte";
import { permissionRuleSchema } from "@nervekit/contracts/permissions";
import type {
  TransferredConversationEvent,
  ConversationSnapshot,
  EventTreeNode,
  ToolCall,
} from "@nervekit/contracts/core";
import type {
  ConversationEntry,
  ConversationTreeNode,
  ToolCallTranscriptRecord,
  ConversationActiveRunSnapshot,
  ConversationLiveContentBlockSnapshot,
  QueuedPromptRecord,
  ApprovalRecord,
  UserQuestionRecord,
  PlanReviewRecord,
} from "$lib/presentation/view-models/conversation";
import type { ConversationRunOutcome } from "$lib/presentation/state/conversation-render-state";
import type { LiveAssistantBlock } from "../state/core-conversation-store.svelte";

function toolPreviewText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  if ("content" in value && typeof value.content === "string")
    return value.content;
  if ("contentBlocks" in value && Array.isArray(value.contentBlocks))
    return value.contentBlocks
      .flatMap((block) =>
        block?.type === "text" && typeof block.text === "string"
          ? [block.text]
          : [],
      )
      .join("\n");
  return "";
}

export function eventEntry(
  event: TransferredConversationEvent,
): ConversationEntry {
  const base: ConversationEntry = {
    id: event.id,
    conversationId: event.conversationId,
    agentId: event.conversationId,
    parentEntryId: event.previousEventId ?? undefined,
    runId: event.turnId ?? undefined,
    turnId: event.turnId ?? undefined,
    kind: "message",
    role: "system",
    text: "",
    createdAt: event.createdAt,
  };
  switch (event.type) {
    case "user_message":
      return {
        ...base,
        role: "user",
        text: event.payload.originalText,
        details: { preparedText: event.payload.text },
      };
    case "assistant_message":
      return {
        ...base,
        role: "assistant",
        liveMessageId: event.id,
        text:
          event.payload.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n") ||
          (event.payload.content.some((b) => b.type === "toolCall")
            ? "[Tool call: " +
              event.payload.content
                .filter((b) => b.type === "toolCall")
                .map((b) => b.name)
                .join(", ") +
              "]"
            : ""),
        usage: { ...event.payload.usage, cost: event.payload.usage.cost.total },
        details: {
          thinkingBlocks: event.payload.content
            .filter((b) => b.type === "thinking")
            .map((b) => ({ text: b.thinking, redacted: b.redacted })),
          content: event.payload.content.map((b) =>
            b.type === "thinking" ? { ...b, text: b.thinking } : b,
          ),
          stopReason: event.payload.stopReason,
          errorMessage: event.payload.errorMessage,
        },
      };
    case "tool_call_response":
      return {
        ...base,
        kind: "tool_result",
        text: toolPreviewText(event.payload.userProjection.resultPreview),
        details: {
          toolCallId: event.payload.providerCallId,
          toolRecordId: event.payload.toolCallId,
          toolName: event.payload.toolName,
          isError: event.payload.outcome === "failed",
        },
      };
    case "compaction":
      return {
        ...base,
        kind: "compaction",
        text: event.payload.summary,
        summary: event.payload.summary,
        tokensBefore: event.payload.tokensBefore,
        firstKeptEntryId: event.payload.firstKeptEventId ?? undefined,
        details: event.payload.details,
      };
    case "system_event": {
      const p = event.payload;
      if (p.subtype === "execution_state")
        return {
          ...base,
          runId: p.transition === "started" ? event.id : p.executionId,
          kind: "run_status",
          text: p.failure?.message ?? p.retry?.error ?? "",
          details: {
            type: "agent_run_retry_status",
            state: p.retry?.exhausted ? "retry_exhausted" : p.transition,
            errorMessage: p.failure?.message ?? p.retry?.error,
            failureCategory: p.failure?.category,
            attempt: p.retry?.attempt,
            maxRetries: p.retry?.maxAttempts,
            delayMs: p.retry?.delayMs,
            retryAt: p.retry
              ? new Date(
                  Date.parse(event.createdAt) + p.retry.delayMs,
                ).toISOString()
              : undefined,
          },
        };
      if (p.subtype === "async_bash_event")
        return {
          ...base,
          kind: "task_event",
          text: p.text,
          details: {
            type: "task_event",

            event: p.status,
            status: p.status,
            exitCode: p.exitCode,
            output: p.text,
          },
        };
      return {
        ...base,
        kind:
          p.subtype === "sub_conversation_event"
            ? "subagent_run_event"
            : "inline_command_result",
        text: p.text,
        details: p,
      };
    }
  }
}

function toolRecord(
  snapshot: ConversationSnapshot,
  source:
    | ToolCall
    | Extract<TransferredConversationEvent, { type: "tool_call_response" }>,
): ToolCallTranscriptRecord {
  const open = "state" in source;
  const p = open ? source : source.payload;
  const status: ToolCallTranscriptRecord["status"] = open
    ? source.state === "running"
      ? "running"
      : source.state === "awaiting_input" ||
          source.state === "awaiting_approval"
        ? "waiting"
        : "committed"
    : source.payload.outcome === "indeterminate"
      ? "failed"
      : source.payload.outcome;
  const time = open ? source.updatedAt : source.createdAt;
  let interaction: ToolCallTranscriptRecord["interaction"];
  if (open && source.interaction && !source.interaction.resolution) {
    const i = source.interaction;
    const base = {
      status: "pending" as const,
      requestedAt: source.updatedAt,
      updatedAt: source.updatedAt,
    };
    if (i.kind === "approval")
      interaction = {
        ...base,
        kind: "approval",
        request: {
          risk: conversationCatalog.toolRisks[source.toolName],
          reason: i.request.reason,
          offeredScopes: [
            "single_call",
            "always_conversation",
            "always_project",
            "always_user",
          ],
          suggestedExceptions: [],
          suggestedRules: i.request.suggestedRules.flatMap((rule) => {
            const parsed = permissionRuleSchema.safeParse(rule);
            return parsed.success ? [parsed.data] : [];
          }),
        },
      };
    if (i.kind === "user_input")
      interaction = {
        ...base,
        kind: "user_input",
        request: { ...i.request, required: true },
      };
    if (i.kind === "plan_review")
      interaction = {
        ...base,
        kind: "plan_review",
        request: {
          planPath: i.request.path,
          title: i.request.title,
          summary: i.request.summary,
          slug: source.id,
          allowNewConversation: false,
        },
      };
  }

  return {
    id: open ? source.id : source.payload.toolCallId,
    projectId: snapshot.conversation.projectId,
    conversationId: snapshot.conversation.id,
    agentId: snapshot.conversation.id,
    toolName: p.toolName,
    argsPreview: open
      ? source.arguments
      : source.payload.userProjection.argsPreview,
    error:
      !open && source.payload.outcome === "failed"
        ? toolPreviewText(source.payload.userProjection.resultPreview)
        : undefined,
    resultPreview: open
      ? undefined
      : source.payload.userProjection.resultPreview,
    previewOverflow: open
      ? undefined
      : source.payload.userProjection.previewOverflow,
    asyncBashView:
      !open && source.payload.outcome === "completed"
        ? asyncBashToolView(
            p.toolName,
            source.payload.userProjection.resultPreview,
            source.payload.userProjection.previewOverflow,
          )
        : undefined,
    status,
    phase:
      status === "committed"
        ? "drafted"
        : status === "running" || status === "waiting"
          ? "executing"
          : status,
    risk: conversationCatalog.toolRisks[p.toolName],
    cwd: snapshot.config.workingDirectory,
    revision: 1,
    attempt: 1,
    interaction,
    providerToolCallId: p.providerCallId ?? undefined,
    contentIndex: p.contentIndex ?? undefined,
    turnId: source.turnId ?? undefined,
    runId: source.turnId ?? undefined,
    liveMessageId: p.assistantEventId ?? undefined,
    createdAt: time,
    updatedAt: time,
    settledAt: open ? undefined : time,
  };
}

export function conversationTranscript(input: {
  snapshot: ConversationSnapshot;
  events: readonly TransferredConversationEvent[];
  liveBlocks: readonly LiveAssistantBlock[];
  toolOutput: Readonly<Record<string, string>>;
  tree?: readonly EventTreeNode[];
}) {
  const { snapshot, events, liveBlocks, toolOutput } = input;
  const visibleEvents = events.filter(
    (event) =>
      !(
        event.type === "system_event" &&
        event.payload.subtype === "execution_state" &&
        ["started", "waiting", "completed", "cancelled"].includes(
          event.payload.transition,
        )
      ),
  );
  const entries = visibleEvents.map((event) => {
    const entry = eventEntry(event);
    if (
      event.type === "system_event" &&
      event.payload.subtype === "async_bash_event"
    ) {
      const bashId = event.payload.bashId;
      const bash = snapshot.asyncBash.find((item) => item.id === bashId);
      if (bash)
        entry.details = {
          ...(entry.details as Record<string, unknown>),
          command: bash.command,
          commandPreview: bash.command.split("\n")[0],
        };
    }
    return entry;
  });
  const runByTurn = new Map<string, string>();
  let executionId: string | undefined;
  for (const event of events) {
    if (
      event.type === "system_event" &&
      event.payload.subtype === "execution_state"
    )
      executionId =
        event.payload.transition === "started"
          ? event.id
          : event.payload.executionId;
    if (event.turnId && executionId) runByTurn.set(event.turnId, executionId);
  }
  const tools = new Map<string, ToolCallTranscriptRecord>();
  for (const e of events)
    if (e.type === "tool_call_response")
      tools.set(e.payload.toolCallId, toolRecord(snapshot, e));
  for (const call of snapshot.toolCalls)
    tools.set(call.id, toolRecord(snapshot, call));
  const queuedPrompts: QueuedPromptRecord[] = snapshot.queue
    .filter((q) => q.source === "user")
    .map((q) => ({
      id: q.inputId,
      agentId: snapshot.conversation.id,
      conversationId: snapshot.conversation.id,
      projectId: snapshot.conversation.projectId,
      text: typeof q.content === "string" ? q.content : q.content.text,
      behavior: "follow-up",
      status: "queued",
      createdAt: q.acceptedAt,
      updatedAt: q.acceptedAt,
    }));
  const execution = events.findLast(
    (e) => e.type === "system_event" && e.payload.subtype === "execution_state",
  );
  const started = events.findLast(
    (e) =>
      e.type === "system_event" &&
      e.payload.subtype === "execution_state" &&
      e.payload.transition === "started",
  );
  const runId =
    execution?.type === "system_event" &&
    execution.payload.subtype === "execution_state" &&
    execution.payload.transition !== "started"
      ? execution.payload.executionId
      : (started?.id ?? liveBlocks[0]?.turnId ?? snapshot.conversation.id);
  for (const entry of entries)
    if (entry.turnId) entry.runId = runByTurn.get(entry.turnId) ?? entry.turnId;
  for (const call of tools.values())
    call.runId = call.turnId ? (runByTurn.get(call.turnId) ?? runId) : runId;
  const running =
    snapshot.conversation.status === "running" ||
    snapshot.conversation.status === "waiting";
  const activeRun: ConversationActiveRunSnapshot | undefined = running
    ? {
        runId,
        conversationId: snapshot.conversation.id,
        agentId: snapshot.conversation.id,
        projectId: snapshot.conversation.projectId,
        status:
          snapshot.conversation.status === "waiting" ? "waiting" : "running",
        startedAt: started?.createdAt ?? snapshot.conversation.updatedAt,
        turns: [...new Set(liveBlocks.map((b) => b.turnId))].map(
          (turnId, ordinal) => ({
            turnId,
            ordinal,
            messages: [
              {
                liveMessageId: turnId,
                messageOrdinal: 0,
                startedAt:
                  started?.createdAt ?? snapshot.conversation.updatedAt,
                blocks: liveBlocks
                  .filter((b) => b.turnId === turnId)
                  .flatMap<ConversationLiveContentBlockSnapshot>((b) =>
                    b.toolCall
                      ? [
                          {
                            kind: "tool_call_draft" as const,
                            contentBlockId: `${turnId}:${b.contentIndex}`,
                            contentIndex: b.contentIndex,
                            providerToolCallId: b.toolCall.providerCallId,
                            toolName: b.toolCall.name,
                            argsText: b.toolCall.partialArgsText,
                            progressRevision: 0,
                            done: false,
                          },
                        ]
                      : [
                          {
                            kind: b.thinking
                              ? ("thinking" as const)
                              : ("text" as const),
                            contentBlockId: `${turnId}:${b.contentIndex}`,
                            contentIndex: b.contentIndex,
                            text: b.thinking || b.text,
                            done: false,
                          },
                        ],
                  ),
              },
            ],
          }),
        ),
        toolOutputsByToolCallId: Object.fromEntries(
          Object.entries(toolOutput).map(([id, text]) => [
            id,
            {
              toolCallId: id,
              text,
              chunks: [],
              updatedAt: snapshot.conversation.updatedAt,
            },
          ]),
        ),
        queuedPrompts,
      }
    : undefined;
  const transition =
    execution?.type === "system_event" &&
    execution.payload.subtype === "execution_state"
      ? execution.payload.transition
      : undefined;
  const lastRunOutcome: ConversationRunOutcome | undefined =
    !running &&
    started &&
    execution &&
    transition &&
    ["completed", "failed", "cancelled", "interrupted"].includes(transition)
      ? {
          runId,
          startedAt: started.createdAt,
          endedAt: execution.createdAt,
          outcome:
            transition === "completed"
              ? "completed"
              : transition === "cancelled"
                ? "stopped"
                : "failed",
        }
      : undefined;
  const sourceTree = input.tree?.length
    ? input.tree
    : events.map((e) => ({
        id: e.id,
        previousEventId: e.previousEventId,
        type: e.type,
        preview: eventEntry(e).text,
        createdAt: e.createdAt,
      }));
  const treeNodes: ConversationTreeNode[] = sourceTree.map((n) => ({
    entry: entries.find((e) => e.id === n.id) ?? {
      id: n.id,
      conversationId: snapshot.conversation.id,
      parentEntryId: n.previousEventId ?? undefined,
      role:
        n.type === "user_message"
          ? "user"
          : n.type === "assistant_message"
            ? "assistant"
            : "system",
      kind: "message",
      text: n.preview,
      createdAt: n.createdAt,
    },
    childEntryIds: sourceTree
      .filter((c) => c.previousEventId === n.id)
      .map((c) => c.id),
  }));
  const approvals: (ApprovalRecord & { toolCall: ToolCallTranscriptRecord })[] =
    [];
  const pendingUserQuestions: UserQuestionRecord[] = [];
  const pendingPlanReviews: PlanReviewRecord[] = [];
  for (const call of snapshot.toolCalls) {
    const i = call.interaction;
    if (!i || i.resolution) continue;
    const base = {
      id: call.id,
      toolCallId: call.id,
      agentId: snapshot.conversation.id,
      conversationId: snapshot.conversation.id,
      projectId: snapshot.conversation.projectId,
      requestedAt: call.updatedAt,
      updatedAt: call.updatedAt,
    };
    if (i.kind === "approval")
      approvals.push({
        ...base,
        risk: conversationCatalog.toolRisks[call.toolName],
        reason: i.request.reason,
        status: "pending",
        offeredScopes: [
          "single_call",
          "always_conversation",
          "always_project",
          "always_user",
        ],
        suggestedExceptions: [],
        suggestedRules: i.request.suggestedRules.flatMap((rule) => {
          const parsed = permissionRuleSchema.safeParse(rule);
          return parsed.success ? [parsed.data] : [];
        }),
        toolCall: tools.get(call.id)!,
      });
    if (i.kind === "user_input")
      pendingUserQuestions.push({ ...base, ...i.request, status: "pending" });
    if (i.kind === "plan_review")
      pendingPlanReviews.push({
        ...base,
        slug: call.id,
        planPath: i.request.path,
        title: i.request.title,
        summary: i.request.summary,
        content: i.request.content,
        status: "pending",
      });
  }
  return {
    entries,
    toolCalls: [...tools.values()],
    treeNodes,
    activeRun,
    lastRunOutcome,
    queuedPrompts,
    approvals,
    pendingUserQuestions,
    pendingPlanReviews,
    sending: running,
    optimisticMessages: [],
    recoveryIssues: events.flatMap((event) =>
      event.type === "tool_call_response" &&
      event.payload.outcome === "indeterminate"
        ? [
            {
              id: event.id,
              conversationId: event.conversationId,
              code: "outcome_unknown" as const,
              message: toolPreviewText(
                event.payload.userProjection.resultPreview,
              ),
              actions: ["inspect" as const],
              createdAt: event.createdAt,
              proposalId: event.payload.toolCallId,
            },
          ]
        : [],
    ),
  };
}
