import { prepareImportedResult } from "./result-projection.js";
import {
  conversationEventSchema,
  interactionResolutionSchema,
  supervisionSchema,
  type ConversationEvent,
} from "./shapes.js";
import type { CoreStorage } from "./storage.js";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  ImportIds,
  ImportReport,
  iso,
  type Legacy,
  type LegacyRow,
} from "./legacy.reader.js";

export interface AssistantOrigin {
  eventId: string;
  contentIndex: number;
  conversationId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  turnId: string | null;
  createdAt: string;
}
export interface EventMapping {
  storage: CoreStorage;
  ids: ImportIds;
  report: ImportReport;
  dataDir: string;
  origins: Map<string, AssistantOrigin>;
  toolAssets: Map<string, string[]>;
  sourceAssets: Map<string, Legacy>;
  generatedAssets: Map<string, Legacy>;
  responseEvents: Map<string, string>;
  providerResponseEvents: Map<string, string>;
}

export function readPayload(
  dataDir: string,
  logicalPath: string,
): Legacy | null {
  try {
    const root = realpathSync(dataDir);
    const path = realpathSync(resolve(root, logicalPath));
    const rel = relative(root, path);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith("../")) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function responsePayload(
  mapping: EventMapping,
  call: Legacy,
  conversationId: string,
  message?: Legacy,
): Legacy {
  const id = mapping.ids.get(
    "tool",
    call.id ?? message?.details?.toolCall?.id ?? message?.toolCallId,
  );
  const providerCallId =
    call.providerToolCallId ??
    call.sourceToolCallId ??
    message?.toolCallId ??
    null;
  const origin = mapping.origins.get(providerCallId);
  const completed = ["completed", "failed", "denied", "cancelled"].includes(
    call.status,
  );
  const outcome = completed
    ? call.status
    : call.status === "running" || call.phase === "executing"
      ? "indeterminate"
      : "cancelled";
  let raw = call.result;
  if (!raw && call.resultPayload?.logicalPath) {
    raw = readPayload(mapping.dataDir, call.resultPayload.logicalPath);
    if (!raw) mapping.report.loss("Missing tool result payload file");
  }
  // Some payload versions wrap the result, others store the envelope directly.
  raw = raw?.result ?? raw;
  const modelContent = message?.content ??
    raw?.contentBlocks ??
    call.agentProjection?.content ?? [
      {
        type: "text",
        text:
          raw?.content ??
          call.error ??
          (completed
            ? "Imported tool result"
            : "Tool call settled during migration; execution was not resumed."),
      },
    ];
  const result =
    typeof raw === "object" && raw !== null
      ? {
          ...raw,
          details: {
            ...(raw.details ?? {}),
            importedLegacy: {
              status: call.status ?? null,
              supervision: call.supervision ?? null,
              interactions: call.interactions ?? null,
            },
          },
        }
      : { contentBlocks: modelContent };
  const decision = call.supervision?.decision ?? call.permissionEvaluation;
  const supervision = decision
    ? supervisionSchema.safeParse({
        decision:
          decision.decision === "prompt" ? "approval" : decision.decision,
        reason: decision.reason,
        matchedRule: call.permissionEvaluation?.winningRule,
        suggestedRules: decision.suggestedRules ?? [],
        authority: {
          imported: true,
          policySnapshotHash: decision.policySnapshotHash ?? null,
        },
      })
    : null;
  const resolved = (call.interactions ?? []).findLast(
    (item: Legacy) => item.resolution,
  );
  const oldResolution = resolved?.resolution;
  let translatedResolution = oldResolution;
  if (resolved?.kind === "approval" && oldResolution?.action) {
    const persistScope = (
      {
        always_conversation: "conversation",
        always_project: "project",
        always_user: "user",
      } as Record<string, string>
    )[oldResolution.scope];
    translatedResolution = {
      kind: "approval",
      decision: oldResolution.action === "allow" ? "approve" : "deny",
      ...(persistScope ? { persistScope } : {}),
    };
  } else if (
    resolved?.kind === "user_input" &&
    oldResolution?.action === "answer"
  ) {
    translatedResolution = {
      kind: "user_input",
      answers: { answer: oldResolution.answer ?? "" },
    };
  } else if (resolved?.kind === "plan_review" && oldResolution?.action) {
    translatedResolution = {
      kind: "plan_review",
      decision: oldResolution.action.startsWith("accept")
        ? "approve"
        : "reject",
      ...(oldResolution.feedback ? { feedback: oldResolution.feedback } : {}),
    };
  }
  const resolution =
    interactionResolutionSchema.safeParse(translatedResolution);
  if (resolved && !resolution.success)
    mapping.report.loss(
      "Legacy interaction retained in result details rather than typed resolution",
    );
  const toolName = call.toolName ?? message?.toolName ?? "unknown";
  const args = providerCallId
    ? (origin?.arguments ?? call.args ?? {})
    : { command: call.args?.command ?? "" };
  const projections = prepareImportedResult(
    mapping,
    conversationId,
    id,
    toolName,
    args,
    result,
    modelContent,
    call.resultPayload?.logicalPath,
  );
  return {
    toolCallId: id,
    providerCallId,
    toolName: call.toolName ?? message?.toolName ?? "unknown",
    arguments: providerCallId
      ? (origin?.arguments ?? call.args ?? {})
      : { command: call.args?.command ?? "" },
    origin: providerCallId ? "model" : "user",
    assistantEventId: origin?.eventId ?? null,
    contentIndex: origin?.contentIndex ?? null,
    outcome: call.status ? outcome : message?.isError ? "failed" : "completed",
    ...projections,
    supervision: supervision?.success ? supervision.data : null,
    interactionResolution: resolution.success ? resolution.data : null,
    resolutionRequestId: resolved?.resolutionRequestId ?? null,
  };
}

export function mapMessage(
  mapping: EventMapping,
  row: LegacyRow,
  data: Legacy,
  base: Legacy,
  call: Legacy | null,
): ConversationEvent | null {
  const entry = data.entry ?? {};
  const context = data.modelContext?.entry ?? {};
  const message = context.message;
  if (
    ["model_change", "thinking_level_change", "active_tools_change"].includes(
      entry.kind ?? context.type,
    )
  ) {
    mapping.report.skip("Current-only configuration entry");
    return null;
  }
  let event: Legacy;
  if (
    context.type === "compaction" ||
    context.type === "branch_summary" ||
    row.kind === "summary"
  ) {
    event = {
      ...base,
      type: "compaction",
      llmRepresentation: "user",
      payload: {
        summary: context.summary ?? entry.text ?? "",
        firstKeptEventId: null,
        tokensBefore: context.tokensBefore ?? 0,
        details: context.details ?? entry.details ?? null,
      },
    };
    if (context.firstKeptEntryId)
      event.payload.firstKeptEventId = mapping.ids.get(
        "evt",
        context.firstKeptEntryId,
      );
  } else if (message?.role === "assistant") {
    event = {
      ...base,
      type: "assistant_message",
      llmRepresentation: "assistant",
      payload: message,
    };
  } else if (message?.role === "toolResult" || entry.kind === "tool_result") {
    const fallback = message ?? {
      toolCallId: entry.details?.toolCallId,
      toolName: entry.details?.toolName,
      content: [{ type: "text", text: entry.text ?? "" }],
      isError: entry.details?.isError,
    };
    const payload = responsePayload(
      mapping,
      call ?? { id: entry.details?.toolRecordId },
      base.conversationId,
      fallback,
    );
    event = {
      ...base,
      type: "tool_call_response",
      llmRepresentation: payload.origin === "model" ? "tool_result" : "user",
      payload,
    };
  } else if (message?.role === "user" || entry.role === "user") {
    const content = message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((block: Legacy) => block.type === "text")
              .map((block: Legacy) => block.text)
              .join("\n")
          : (entry.text ?? "");
    if (
      Array.isArray(content) &&
      content.some((block: Legacy) => block.type !== "text")
    )
      mapping.report.loss(
        "User images cannot be represented by text-only user_message schema",
      );
    event = {
      ...base,
      type: "user_message",
      llmRepresentation: "user",
      payload: {
        text,
        originalText: entry.details?.originalText ?? text,
        source: "user",
        senderConversationId: null,
        commandPreparation: null,
      },
    };
  } else {
    event = {
      ...base,
      type: "system_event",
      llmRepresentation:
        data.modelContext?.visibility === "model_and_history" ? "user" : "none",
      payload: {
        subtype: "notification",
        producer: `import:${entry.kind ?? context.type ?? "system"}`,
        text: entry.text ?? JSON.stringify(context),
      },
    };
  }
  return conversationEventSchema.parse(event);
}

export function insertEvent(
  mapping: EventMapping,
  event: ConversationEvent,
): void {
  mapping.storage.events.insert(event);
  if (event.type === "assistant_message") {
    event.payload.content.forEach((block: Legacy, contentIndex: number) => {
      if (block.type === "toolCall")
        mapping.origins.set(block.id, {
          eventId: event.id,
          contentIndex,
          conversationId: event.conversationId,
          toolName: block.name,
          arguments: block.arguments,
          turnId: event.turnId,
          createdAt: event.createdAt,
        });
    });
  } else if (event.type === "tool_call_response") {
    mapping.responseEvents.set(event.payload.toolCallId, event.id);
    if (event.payload.providerCallId)
      mapping.providerResponseEvents.set(
        event.payload.providerCallId,
        event.id,
      );
  }
}

export function eventBase(
  mapping: EventMapping,
  row: LegacyRow,
  data: Legacy,
  conversationId: string,
  sequence: number,
  previousEventId: string | null,
): Legacy {
  return {
    id: mapping.ids.get("evt", String(row.id)),
    conversationId,
    sequence,
    previousEventId,
    turnId: data.entry?.turnId
      ? mapping.ids.get("turn", data.entry.turnId)
      : null,
    inputId: null,
    createdAt: iso(data.entry?.createdAt ?? row.created_at_ms),
  };
}
