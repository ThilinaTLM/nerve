import { conversationEventSchema } from "@nervekit/contracts/core";
import type { AssetOwner } from "./assets.importer.js";
import { collectAssets, insertAssets } from "./assets.importer.js";
import {
  eventBase,
  insertEvent,
  mapMessage,
  responsePayload,
  type EventMapping,
} from "./events.mapper.js";
import { iso, type Legacy, type LegacyReader } from "./legacy.reader.js";
import { importPendingInput } from "./input.mapper.js";
import {
  importConversationScopes,
  type ImportScope,
} from "./conversation-scope.mapper.js";

export function importConversation(
  reader: LegacyReader,
  mapping: EventMapping,
  conversation: Legacy,
  agents: Legacy[],
  inputs: Legacy[],
  tasks: Legacy[],
): void {
  const { rootId, scopes, owner, project } = importConversationScopes(
    reader,
    mapping,
    conversation,
    agents,
  );
  const tools = new Map<string, AssetOwner>();
  const providerTools = new Map<string, string>();
  for (const { row, data } of reader.records(conversation.id, "tool_call")) {
    const call = data.toolCall ?? {};
    tools.set(String(row.id), {
      conversationId: owner(row.agent_id).id,
      toolCallId: mapping.ids.get("tool", String(row.id)),
    });
    if (call.providerToolCallId ?? call.sourceToolCallId)
      providerTools.set(
        call.providerToolCallId ?? call.sourceToolCallId,
        String(row.id),
      );
  }
  const assets = collectAssets(
    reader,
    mapping,
    conversation.id,
    rootId,
    tools,
    tasks,
  );
  // Metadata only: no message bodies or run transition snapshots accumulate.
  const predecessors = new Map<string, { id: string | null; scope: string }>();
  const selected = new Map<string, string | null>();
  for (const row of reader.db
    .prepare(
      "SELECT agent_id, active_record_id FROM agent_context_leaves WHERE conversation_id = ?",
    )
    .iterate(conversation.id)) {
    selected.set(
      row.agent_id === "agent_conversation" ? rootId : owner(row.agent_id).id,
      row.active_record_id === null ? null : String(row.active_record_id),
    );
  }
  if (!selected.has(rootId) && conversation.activeEntryId !== undefined)
    selected.set(rootId, conversation.activeEntryId);
  const runEnds: {
    scope: ImportScope;
    run: Legacy;
    executionId: string;
    transitions: Legacy[];
  }[] = [];
  const eventParents = new Map<string, string | null>();
  const responseProviders = new Map<string, string>();
  const append = (scope: ImportScope, event: Legacy): void => {
    const parsed = conversationEventSchema.parse({
      ...event,
      conversationId: scope.id,
      sequence: ++scope.sequence,
      previousEventId:
        event.previousEventId === undefined
          ? scope.head
          : event.previousEventId,
      turnId: event.turnId ?? null,
      inputId: event.inputId ?? null,
    });
    insertEvent(mapping, parsed);
    eventParents.set(parsed.id, parsed.previousEventId);
    if (parsed.type === "tool_call_response" && parsed.payload.providerCallId)
      responseProviders.set(parsed.id, parsed.payload.providerCallId);
    scope.head = parsed.id;
    if (parsed.type === "user_message")
      scope.lastUserMessageAt = parsed.createdAt;
  };
  const ensureOrigin = (
    scope: ImportScope,
    call: Legacy,
    message?: Legacy,
  ): void => {
    const providerId =
      call.providerToolCallId ?? call.sourceToolCallId ?? message?.toolCallId;
    if (!providerId || mapping.origins.has(providerId)) return;
    mapping.report.loss(
      "Reconstructed missing assistant tool-call block from tool record",
    );
    const config = mapping.storage.conversations.getConfig(scope.id)!;
    append(scope, {
      id: mapping.ids.get("evt", `assistant:${call.id ?? providerId}`),
      type: "assistant_message",
      llmRepresentation: "assistant",
      createdAt: iso(call.createdAt),
      turnId: call.turnId ? mapping.ids.get("turn", call.turnId) : null,
      payload: {
        content: [
          {
            type: "toolCall",
            id: providerId,
            name: call.toolName ?? message?.toolName ?? "unknown",
            arguments: call.args ?? {},
          },
        ],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        api: "import",
        provider: config.model.provider,
        model: config.model.modelId,
      },
    });
  };
  for (const { row, data } of reader.records(conversation.id)) {
    const scope = owner(row.agent_id);
    if (row.kind === "run") {
      const run = data.run ?? data.state?.run;
      if (!run) {
        mapping.report.skip("Run record without run state");
        continue;
      }
      const executionId = mapping.ids.get("evt", `execution:${row.id}`);
      append(scope, {
        id: executionId,
        type: "system_event",
        llmRepresentation: "none",
        createdAt: iso(run.startedAt ?? run.createdAt),
        payload: { subtype: "execution_state", transition: "started" },
      });
      const transitions: Legacy[] = [];
      for (const transition of data.state?.transitions ?? []) {
        if (
          !["waiting", "retrying", "retry_exhausted"].includes(transition.kind)
        )
          continue;
        const failure =
          transition.run?.failure ?? transition.execution?.failure;
        transitions.push({
          id: mapping.ids.get("evt", transition.transitionId),
          createdAt: iso(transition.committedAt),
          payload: {
            subtype: "execution_state",
            transition: transition.kind === "waiting" ? "waiting" : "retrying",
            executionId,
            ...(failure
              ? {
                  failure: {
                    message:
                      typeof failure.message === "string"
                        ? failure.message
                        : JSON.stringify(failure),
                  },
                }
              : {}),
          },
        });
      }
      runEnds.push({ scope, run, executionId, transitions });
      continue;
    }
    if (row.kind === "tool_call" || row.kind === "tool_batch") continue;
    const entry = data.entry ?? {};
    const context = data.modelContext?.entry;
    const oldParent = context?.parentId ?? entry.parentEntryId ?? row.parent_id;
    const predecessor = oldParent ? predecessors.get(oldParent) : undefined;
    let previousEventId = oldParent
      ? predecessor?.scope === scope.id
        ? predecessor.id
        : null
      : scope.head;
    if (oldParent && !predecessor)
      mapping.report.loss(
        "Missing predecessor; imported as separate branch root",
      );
    const message = context?.message;
    const callId =
      message?.details?.toolCall?.id ??
      entry.details?.toolRecordId ??
      providerTools.get(message?.toolCallId ?? entry.details?.toolCallId);
    const call = callId ? (reader.record(callId)?.toolCall ?? null) : null;
    if (message?.role === "toolResult" || entry.kind === "tool_result") {
      const providerId =
        call?.providerToolCallId ??
        call?.sourceToolCallId ??
        message?.toolCallId ??
        entry.details?.toolCallId;
      if (providerId && !mapping.origins.has(providerId)) {
        scope.head = previousEventId;
        ensureOrigin(
          scope,
          call ?? {
            id: callId,
            providerToolCallId: providerId,
            toolName: message?.toolName ?? entry.details?.toolName,
          },
          message,
        );
        previousEventId = scope.head;
      }
      const toolId = mapping.ids.get(
        "tool",
        call?.id ?? callId ?? providerId ?? String(row.id),
      );
      if (mapping.responseEvents.has(toolId)) {
        mapping.report.skip("Duplicate tool result for same call");
        predecessors.set(String(row.id), {
          id: previousEventId,
          scope: scope.id,
        });
        continue;
      }
    }
    const base = eventBase(
      mapping,
      row,
      data,
      scope.id,
      scope.sequence + 1,
      previousEventId,
    );
    const event = mapMessage(mapping, row, data, base, call);
    if (event) {
      append(scope, event);
      predecessors.set(String(row.id), { id: event.id, scope: scope.id });
      if (entry.id)
        predecessors.set(entry.id, { id: event.id, scope: scope.id });
      if (context?.id)
        predecessors.set(context.id, { id: event.id, scope: scope.id });
    } else
      predecessors.set(String(row.id), {
        id: previousEventId,
        scope: scope.id,
      });
  }
  // Choose the original selected leaf before adding settlement facts. Explicit
  // empty selection stays empty; inactive branches are never silently selected.
  for (const scope of scopes.values()) {
    if (selected.has(scope.id)) {
      const oldHead = selected.get(scope.id);
      scope.head = oldHead ? (predecessors.get(oldHead)?.id ?? null) : null;
      if (oldHead && !scope.head)
        mapping.report.loss("Selected leaf is missing from imported records");
    }
  }
  for (const { row, data } of reader.records(conversation.id, "tool_call")) {
    const call = data.toolCall ?? {};
    const id = mapping.ids.get("tool", call.id ?? String(row.id));
    if (mapping.responseEvents.has(id)) continue;
    const scope = owner(row.agent_id);
    const selectedHead = scope.head;
    const origin = mapping.origins.get(
      call.providerToolCallId ?? call.sourceToolCallId,
    );
    let cursor = selectedHead;
    while (cursor && cursor !== origin?.eventId)
      cursor = eventParents.get(cursor) ?? null;
    const historical = ["completed", "failed", "denied", "cancelled"].includes(
      call.status,
    );
    const preserveSelection = historical && (!origin || !cursor);
    if (preserveSelection) scope.head = origin?.eventId ?? null;
    ensureOrigin(scope, call);
    const payload = responsePayload(mapping, call);
    append(scope, {
      id: mapping.ids.get("evt", `response:${row.id}`),
      type: "tool_call_response",
      llmRepresentation: payload.origin === "model" ? "tool_result" : "user",
      createdAt: iso(call.settledAt ?? call.updatedAt),
      turnId: call.turnId ? mapping.ids.get("turn", call.turnId) : null,
      payload,
    });
    if (preserveSelection) scope.head = selectedHead;
  }
  const branchTails = new Map<string, string>();
  for (const [providerCallId, origin] of mapping.origins) {
    if (mapping.providerResponseEvents.has(providerCallId)) continue;
    const scope = scopes.get(origin.conversationId)!;
    const selectedHead = scope.head;
    let cursor = selectedHead;
    while (cursor && cursor !== origin.eventId)
      cursor = eventParents.get(cursor) ?? null;
    if (!cursor) scope.head = branchTails.get(origin.eventId) ?? origin.eventId;
    const call = {
      id: providerCallId,
      providerToolCallId: providerCallId,
      toolName: origin.toolName,
      status: "running",
      error:
        "No durable result existed for this call at migration; its outcome is indeterminate and it was not replayed.",
    };
    const payload = responsePayload(mapping, call);
    append(scope, {
      id: mapping.ids.get(
        "evt",
        `missing-response:${origin.eventId}:${providerCallId}`,
      ),
      type: "tool_call_response",
      llmRepresentation: "tool_result",
      createdAt: origin.createdAt,
      turnId: origin.turnId,
      payload,
    });
    branchTails.set(origin.eventId, scope.head!);
    if (!cursor) scope.head = selectedHead;
    mapping.report.loss(
      "Assistant tool-call block without durable result settled as indeterminate",
    );
  }
  const selectedPaths = new Map<string, Set<string>>();
  const selectedResponses = new Map<string, Set<string>>();
  for (const scope of scopes.values()) {
    const path = new Set<string>();
    const responses = new Set<string>();
    let cursor = scope.head;
    while (cursor) {
      path.add(cursor);
      const provider = responseProviders.get(cursor);
      if (provider) responses.add(provider);
      cursor = eventParents.get(cursor) ?? null;
    }
    selectedPaths.set(scope.id, path);
    selectedResponses.set(scope.id, responses);
  }
  for (const [providerCallId, origin] of mapping.origins) {
    if (
      !selectedPaths.get(origin.conversationId)?.has(origin.eventId) ||
      selectedResponses.get(origin.conversationId)?.has(providerCallId)
    )
      continue;
    const responseId = mapping.providerResponseEvents.get(providerCallId);
    const response = responseId ? mapping.storage.events.get(responseId) : null;
    if (!response) continue;
    const scope = scopes.get(origin.conversationId)!;
    append(scope, {
      ...response,
      id: mapping.ids.get(
        "evt",
        `selected-response:${origin.eventId}:${providerCallId}`,
      ),
      previousEventId: scope.head,
    });
    mapping.report.loss(
      "Selected branch lacked a result recorded elsewhere; result copied onto selected branch",
    );
  }
  for (const { scope, run, executionId, transitions } of runEnds) {
    for (const transition of transitions)
      append(scope, {
        ...transition,
        type: "system_event",
        llmRepresentation: "none",
      });
    const transition = [
      "completed",
      "failed",
      "cancelled",
      "interrupted",
    ].includes(run.status)
      ? run.status
      : "interrupted";
    append(scope, {
      id: mapping.ids.get("evt", `execution-end:${run.runId}`),
      type: "system_event",
      llmRepresentation: "none",
      createdAt: iso(run.terminalAt ?? run.updatedAt),
      payload: {
        subtype: "execution_state",
        transition,
        executionId,
        ...(run.error || run.failure
          ? {
              failure: {
                message:
                  typeof run.error === "string"
                    ? run.error
                    : JSON.stringify(run.error ?? run.failure),
              },
            }
          : {}),
      },
    });
    scope.status =
      transition === "failed"
        ? "failed"
        : transition === "interrupted" || transition === "cancelled"
          ? "interrupted"
          : "idle";
    scope.statusSequence = scope.sequence;
  }
  for (const scope of scopes.values())
    mapping.storage.conversations.update(scope.id, {
      headEventId: scope.head,
      lastUserMessageAt: scope.lastUserMessageAt,
      status: scope.status,
      statusEventSequence: scope.statusSequence,
    });
  for (const input of inputs)
    importPendingInput(mapping, owner(input.agentId).id, input);
  for (const task of tasks) {
    if (task.origin?.kind !== "agent_tool") {
      mapping.report.skip("UI launch task");
      continue;
    }
    const tool = tools.get(task.origin.toolCallId);
    const status = ["completed", "failed", "timed_out", "cancelled"].includes(
      task.status,
    )
      ? task.status
      : "lost";
    mapping.storage.asyncBash.insert({
      id: mapping.ids.get("bash", task.id),
      conversationId: tool?.conversationId ?? rootId,
      toolCallId: mapping.ids.get("tool", task.origin.toolCallId),
      command: task.command ?? "",
      workingDirectory: task.cwd ?? project.directory,
      status,
      processRef: null,
      exitCode: task.exitCode ?? null,
      startedAt: iso(task.startedAt),
      finishedAt: iso(task.finishedAt ?? task.updatedAt),
    });
  }
  insertAssets(mapping, assets);
}
