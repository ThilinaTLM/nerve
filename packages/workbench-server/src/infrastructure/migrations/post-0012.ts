import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { agentRecordSchema } from "@nervekit/contracts/agents";
import {
  conversationEntrySchema,
  conversationRecordSchema,
  type ConversationJournalEvent,
} from "@nervekit/contracts/conversations";
import { providerCatalogSchema } from "@nervekit/contracts/providers";
import {
  runEventDeliveryRecordSchema,
  runTransitionRecordSchema,
  type RunTransitionRecord,
} from "@nervekit/contracts/runs";
import { taskRecordSchema } from "@nervekit/contracts/tasks";
import {
  toolCallRecordSchema,
  type ToolCallRecord,
  type ToolResultPayloadReference,
} from "@nervekit/contracts/tools";
import { ConversationJournalRepository } from "../../domains/conversations/conversation-journal.repository.js";
import { reduceRunTransitions } from "../../domains/runs/runtime/index.js";
import { hydrateToolCallResult } from "../../domains/tools/artifacts/tool-result-artifact.js";
import { prepareToolResult } from "../../domains/tools/artifacts/tool-result-preparation.js";
import { ToolResultPayloadStore } from "../../domains/tools/artifacts/tool-result-payload-store.js";
import { toToolCallTranscriptRecord } from "../../domains/tools/artifacts/tool-call-transcript-preview.js";
import { CanonicalStore } from "../persistence/canonical-sqlite/index.js";
import { pathExists, readJsonFile } from "../storage-bootstrap/json.js";
import type { LegacyConfigurationSource } from "./configuration.js";
import { normalizeSettings } from "./post-0012-settings-normalization.js";

export interface ImportedPayloadAsset {
  category: "payload";
  logicalPath: string;
  conversationId: string;
  toolCallId: string;
  digest: string;
  byteLength: number;
  mediaType: string;
  timestamp: number;
}

export async function readPost0012Configuration(
  home: string,
  credentialNames: Iterable<string>,
): Promise<LegacyConfigurationSource> {
  const rawSettings = await readJsonFile<unknown>(join(home, "config.json"));
  const settings = normalizeSettings(rawSettings).settings;
  const providerPath = join(home, "providers.json");
  const providerCatalog = (await pathExists(providerPath))
    ? providerCatalogSchema.parse(await readJsonFile<unknown>(providerPath))
    : undefined;
  return {
    settings,
    providerCatalog,
    credentialNames,
    // Released post-0012 user rules are still embedded in settings and are
    // projected by configurationWithSettings. Project-scoped trust is not
    // imported into the new digest-bound permission model.
    userRules: [],
  };
}

export async function importPost0012State(input: {
  sourceHome: string;
  targetHome: string;
  targetSqlitePath: string;
  now: Date;
}): Promise<{ payloadAssets: ImportedPayloadAsset[] }> {
  const store = new CanonicalStore(input.targetSqlitePath);
  await store.initialize();
  const journal = new ConversationJournalRepository({
    paths: { home: input.targetHome, sqlitePath: input.targetSqlitePath },
    canonicalStore: store,
  });
  const payloads = new ToolResultPayloadStore(input.targetHome);
  await payloads.initialize();
  const payloadAssets: ImportedPayloadAsset[] = [];
  try {
    await importDocuments(input.sourceHome, store, input.now);
    const conversations = await childDirectories(
      join(input.sourceHome, "conversations"),
    );
    for (const conversationId of conversations) {
      await importConversation(
        input.sourceHome,
        conversationId,
        journal,
        payloads,
        payloadAssets,
      );
    }
    await importRuns(input.sourceHome, journal, input.now);
    for (const conversationId of conversations) {
      const state = await journal.load(conversationId);
      if (state.conversation) {
        await cancelLegacyOrphanInteractions(
          journal,
          conversationId,
          input.now.toISOString(),
        );
      }
      journal.unload(conversationId);
    }
    await importAgentModelContexts(input.sourceHome, journal);
    await store.integrityCheck();
    return { payloadAssets };
  } finally {
    await store.close();
  }
}

async function importDocuments(
  home: string,
  store: CanonicalStore,
  now: Date,
): Promise<void> {
  for (const [directory, fileName, namespace] of [
    ["projects", "project.json", "project"],
    ["agents", "agent.json", "agent"],
    ["tasks", "task.json", "task"],
  ] as const) {
    for (const id of await childDirectories(join(home, directory))) {
      const path = join(home, directory, id, fileName);
      if (!(await pathExists(path))) continue;
      let data = await readJsonFile<unknown>(path);
      if (namespace === "agent") data = parseLegacyAgent(data);
      if (namespace === "task") data = decodeLegacyTask(data);
      await store.writeDocument({
        namespace,
        scopeId: "global",
        documentId: id,
        data,
        expectedRevision: 0,
        now: now.toISOString(),
      });
    }
  }
  for (const projectId of await childDirectories(join(home, "projects"))) {
    for (const [fileName, namespace, documentId] of [
      ["task-definitions.json", "task_definitions", "definitions"],
      ["scratch-notes.json", "scratch_notes", "notes"],
    ] as const) {
      const path = join(home, "projects", projectId, fileName);
      if (!(await pathExists(path))) continue;
      await store.writeDocument({
        namespace,
        scopeId: projectId,
        documentId,
        data: await readJsonFile<unknown>(path),
        expectedRevision: 0,
        now: now.toISOString(),
      });
    }
  }
  for (const [fileName, namespace, idField] of [
    ["enabled.json", "prompt_suggestion_enablement", "definitionKey"],
    ["trust.json", "prompt_suggestion_trust", "trustId"],
  ] as const) {
    const path = join(home, "prompt-suggestions", fileName);
    if (!(await pathExists(path))) continue;
    const raw = await readJsonFile<unknown>(path);
    const records =
      isRecord(raw) && Array.isArray(raw.records) ? raw.records : [];
    for (const record of records) {
      if (!isRecord(record) || typeof record[idField] !== "string") continue;
      await store.writeDocument({
        namespace,
        scopeId: "global",
        documentId: record[idField],
        data: record,
        expectedRevision: 0,
        now: now.toISOString(),
      });
    }
  }
}

async function importConversation(
  home: string,
  conversationId: string,
  journal: ConversationJournalRepository,
  payloads: ToolResultPayloadStore,
  payloadAssets: ImportedPayloadAsset[],
): Promise<void> {
  const directory = join(home, "conversations", conversationId);
  if (await pathExists(join(directory, "journal.jsonl"))) {
    throw new Error(
      `Conversation '${conversationId}' has an unsupported post-0013 journal.`,
    );
  }
  const conversationPath = join(directory, "conversation.json");
  if (!(await pathExists(conversationPath))) return;
  const rawConversation = await readJsonFile<unknown>(conversationPath);
  const conversation = conversationRecordSchema.parse(
    withoutRetiredApprovalPolicy(rawConversation),
  );
  const events: ConversationJournalEvent[] = [
    { kind: "conversation.upserted", conversationId, conversation },
  ];
  for (const value of await jsonLines(join(directory, "entries.jsonl"))) {
    const parsed = conversationEntrySchema.safeParse(value);
    if (parsed.success) {
      events.push({
        kind: "conversation.entry_appended",
        conversationId,
        entry: parsed.data,
      });
    }
  }
  for (const entry of await jsonLines(join(directory, "harness.jsonl"))) {
    if (!isRecord(entry) || entry.type === "conversation") continue;
    events.push({
      kind: "model_context.entry_appended",
      conversationId,
      entry: entry as never,
    });
  }
  for (const toolCall of await legacyToolCalls(
    home,
    directory,
    payloads,
    payloadAssets,
  )) {
    events.push({ kind: "tool_call.upserted", conversationId, toolCall });
  }
  for (let offset = 0; offset < events.length; offset += 256) {
    await journal.commit(conversationId, {
      kind: offset === 0 ? "migration.bootstrap" : "migration.bootstrap_chunk",
      events: events.slice(offset, offset + 256),
      committedAt: conversation.updatedAt,
    });
  }
  journal.unload(conversationId);
}

async function importRuns(
  home: string,
  journal: ConversationJournalRepository,
  now: Date,
): Promise<void> {
  for (const runId of await childDirectories(
    join(home, "run-runtime", "runs"),
  )) {
    const transitions = (
      await jsonLines(
        join(home, "run-runtime", "runs", runId, "transitions.jsonl"),
      )
    ).map((value) => runTransitionRecordSchema.parse(value));
    const conversationId = transitions[0]?.run.conversationId;
    if (!conversationId) continue;
    const aggregate = await journal.load(conversationId);
    if (!aggregate.conversation) continue;
    transitions.sort(compareRunTransitions);
    const deliveries = (
      await jsonLines(
        join(home, "run-runtime", "runs", runId, "event-deliveries.jsonl"),
      )
    )
      .map((value) => runEventDeliveryRecordSchema.parse(value))
      .sort((left, right) => left.deliveredAt.localeCompare(right.deliveredAt));
    const events: ConversationJournalEvent[] = [
      ...transitions.map((transition) => ({
        kind: "run.transition_committed" as const,
        conversationId,
        transition,
      })),
      ...deliveries.map((delivery) => ({
        kind: "run.event_delivered" as const,
        conversationId,
        delivery,
      })),
    ];
    for (let offset = 0; offset < events.length; offset += 256) {
      await journal.commit(conversationId, {
        kind: "migration.run_journal",
        committedAt:
          transitions.at(-1)?.committedAt ??
          deliveries.at(-1)?.deliveredAt ??
          now.toISOString(),
        events: events.slice(offset, offset + 256),
      });
    }
    await normalizeLegacyInteractions(journal, conversationId, transitions);
    journal.unload(conversationId);
  }
}

async function importAgentModelContexts(
  home: string,
  journal: ConversationJournalRepository,
): Promise<void> {
  for (const agentId of await childDirectories(join(home, "agents"))) {
    const path = join(home, "agents", agentId, "conversation.jsonl");
    if (!(await pathExists(path))) continue;
    const lines = await jsonLines(path);
    const header = lines[0];
    if (
      !isRecord(header) ||
      header.type !== "conversation" ||
      typeof header.id !== "string" ||
      !header.id.startsWith("conv_")
    ) {
      throw new Error(`Agent '${agentId}' has an invalid conversation header.`);
    }
    for (let offset = 1; offset < lines.length; offset += 256) {
      await journal.commit(header.id, {
        kind: "migration.agent_model_context",
        events: lines.slice(offset, offset + 256).map((entry) => ({
          kind: "model_context.entry_appended" as const,
          conversationId: header.id as string,
          ownerAgentId: agentId,
          entry: entry as never,
        })),
      });
    }
    journal.unload(header.id);
  }
}

async function legacyToolCalls(
  home: string,
  directory: string,
  payloads: ToolResultPayloadStore,
  payloadAssets: ImportedPayloadAsset[],
): Promise<ToolCallRecord[]> {
  const calls: ToolCallRecord[] = [];
  for (const file of await readdir(join(directory, "tool-calls"), {
    withFileTypes: true,
  }).catch(() => [])) {
    if (!file.isFile() || !file.name.endsWith(".json")) continue;
    const stored = toolCallRecordSchema.parse(
      await readJsonFile<unknown>(join(directory, "tool-calls", file.name)),
    );
    let complete = true;
    const hydrated = await hydrateToolCallResult(home, stored).catch(() => {
      complete = false;
      return toolCallRecordSchema.parse({
        ...stored,
        result: isLegacyArtifactMarker(stored.result)
          ? { content: "Legacy complete tool result is unavailable." }
          : stored.result,
      });
    });
    const recovered = await recoverLegacyCompleteResult(home, hydrated);
    complete &&= recovered.complete;
    const prepared =
      hydrated.result === undefined
        ? { result: undefined, resultPayload: undefined }
        : await prepareToolResult(recovered.result, {
            toolCallId: hydrated.id,
            conversationId: hydrated.conversationId,
            payloads,
          });
    const resultPayload = prepared.resultPayload
      ? {
          ...prepared.resultPayload,
          completeness: complete
            ? ("complete" as const)
            : ("legacy_bounded" as const),
        }
      : !complete && prepared.result !== undefined
        ? await payloads.write(
            hydrated.conversationId,
            hydrated.id,
            stripLegacyRecoveryMetadata(prepared.result),
            "legacy_bounded",
          )
        : undefined;
    if (resultPayload) payloadAssets.push(payloadAsset(resultPayload));
    const nextBase = toolCallRecordSchema.parse({
      ...hydrated,
      result: stripLegacyRecoveryMetadata(prepared.result),
      resultPayload,
      resultPreview: undefined,
    });
    calls.push(
      toolCallRecordSchema.parse({
        ...nextBase,
        resultPreview: toToolCallTranscriptRecord(nextBase).resultPreview,
      }),
    );
  }
  return calls.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function payloadAsset(
  reference: ToolResultPayloadReference,
): ImportedPayloadAsset {
  return {
    category: "payload",
    logicalPath: reference.logicalPath,
    conversationId: reference.conversationId,
    toolCallId: reference.toolCallId,
    digest: reference.digest,
    byteLength: reference.byteLength,
    mediaType: reference.mediaType,
    timestamp: Date.now(),
  };
}

async function recoverLegacyCompleteResult(
  home: string,
  toolCall: ToolCallRecord,
): Promise<{ result: unknown; complete: boolean }> {
  const rawPath = legacyRawResultPath(toolCall.result);
  if (!rawPath) return { result: toolCall.result, complete: true };
  const legacyRoot = resolve(home, "tmp", "tool-results");
  const candidate = resolve(rawPath);
  if (
    !isAbsolute(rawPath) ||
    (candidate !== legacyRoot && !candidate.startsWith(`${legacyRoot}${sep}`))
  ) {
    return { result: toolCall.result, complete: false };
  }
  try {
    return {
      result: JSON.parse(await readFile(candidate, "utf8")) as unknown,
      complete: true,
    };
  } catch {
    return { result: toolCall.result, complete: false };
  }
}

function isLegacyArtifactMarker(result: unknown): boolean {
  return isRecord(result) && "__nerveToolResultArtifact" in result;
}

function legacyRawResultPath(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  if (typeof result.rawResultPath === "string") return result.rawResultPath;
  const metadata = isRecord(result.metadata) ? result.metadata : undefined;
  return typeof metadata?.rawResultPath === "string"
    ? metadata.rawResultPath
    : undefined;
}

function stripLegacyRecoveryMetadata(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const next = { ...value };
  delete next.rawResultPath;
  if (isRecord(next.metadata)) {
    const metadata = { ...next.metadata };
    delete metadata.rawResultPath;
    next.metadata = metadata;
  }
  return next;
}

async function normalizeLegacyInteractions(
  journal: ConversationJournalRepository,
  conversationId: string,
  transitions: RunTransitionRecord[],
): Promise<void> {
  for (const runId of new Set(
    transitions.map((transition) => transition.runId),
  )) {
    const runTransitions = transitions
      .filter((transition) => transition.runId === runId)
      .sort((left, right) => left.revision - right.revision);
    const runState = reduceRunTransitions(runTransitions);
    if (!runState || runState.run.status !== "waiting") continue;
    const state = await journal.load(conversationId);
    const valid = runState.interactions
      .filter((interaction) => interaction.status === "pending")
      .filter((interaction) => {
        const toolCall = state.toolCalls.get(interaction.toolCallId);
        return Boolean(
          toolCall &&
          toolCall.revision === interaction.toolCallRevision &&
          toolCall.interactions[interaction.interactionOrdinal]?.status ===
            "pending",
        );
      });
    if (valid.length === 0) continue;
    const events: ConversationJournalEvent[] = valid.map((interaction) => {
      const toolCall = state.toolCalls.get(interaction.toolCallId)!;
      return {
        kind: "interaction.upserted",
        conversationId,
        interaction: {
          id: interaction.id,
          conversationId,
          runId,
          executionId: runState.run.executionId,
          suspensionId: legacySuspensionId(interaction.checkpointId),
          checkpointId: interaction.checkpointId,
          toolCallId: toolCall.id,
          toolCallRevision: toolCall.revision,
          interaction: toolCall.interactions[interaction.interactionOrdinal]!,
        },
      };
    });
    for (const checkpointId of new Set(
      valid.map((value) => value.checkpointId),
    )) {
      const members = valid.filter(
        (value) => value.checkpointId === checkpointId,
      );
      const orderedIds =
        members[0]?.batchToolCallIds ??
        members.map((value) => value.toolCallId);
      const ordered = orderedIds.flatMap((toolCallId) => {
        const value = members.find(
          (candidate) => candidate.toolCallId === toolCallId,
        );
        return value ? [value] : [];
      });
      events.push({
        kind: "suspension.upserted",
        conversationId,
        suspension: {
          id: legacySuspensionId(checkpointId),
          conversationId,
          runId,
          executionId: runState.run.executionId,
          checkpointId,
          status: "open",
          members: ordered.map((interaction, ordinal) => ({
            ordinal,
            interactionId: interaction.id,
            toolCallId: interaction.toolCallId,
            toolCallRevision: interaction.toolCallRevision,
            kind: interaction.kind,
          })),
          createdAt: ordered[0]!.createdAt,
          updatedAt: runState.run.updatedAt,
        },
      });
    }
    await journal.commit(conversationId, {
      kind: "migration.normalized_interactions",
      committedAt: runState.run.updatedAt,
      events,
    });
  }
}

async function cancelLegacyOrphanInteractions(
  journal: ConversationJournalRepository,
  conversationId: string,
  now: string,
): Promise<void> {
  const state = await journal.load(conversationId);
  const actionable = new Set(
    [...state.suspensions.values()]
      .filter((suspension) => suspension.status === "open")
      .flatMap((suspension) =>
        suspension.members.map((member) => member.toolCallId),
      ),
  );
  const events: ConversationJournalEvent[] = [];
  for (const toolCall of state.toolCalls.values()) {
    if (
      toolCall.status !== "waiting" ||
      actionable.has(toolCall.id) ||
      !toolCall.interactions.some(
        (interaction) => interaction.status === "pending",
      )
    ) {
      continue;
    }
    events.push({
      kind: "tool_call.upserted",
      conversationId,
      toolCall: {
        ...toolCall,
        revision: toolCall.revision + 1,
        status: "failed",
        error: "Pending interaction was cancelled during storage migration.",
        updatedAt: now,
        settledAt: now,
        interactions: toolCall.interactions.map((interaction) =>
          interaction.status === "pending"
            ? {
                ...interaction,
                status: "cancelled" as const,
                updatedAt: now,
                cancelledAt: now,
              }
            : interaction,
        ),
      },
    });
  }
  for (let offset = 0; offset < events.length; offset += 256) {
    await journal.commit(conversationId, {
      kind: "migration.cancelled_orphan_interactions",
      committedAt: now,
      events: events.slice(offset, offset + 256),
    });
  }
}

function parseLegacyAgent(value: unknown): unknown {
  return agentRecordSchema.parse(withoutRetiredApprovalPolicy(value));
}

function withoutRetiredApprovalPolicy(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const migrated = { ...value };
  delete migrated.approvalPolicy;
  return migrated;
}

const terminalTaskStatuses = new Set([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "orphaned",
  "interrupted",
]);

function decodeLegacyTask(value: unknown): unknown {
  const current = taskRecordSchema.safeParse(value);
  if (current.success) return current.data;
  if (!isRecord(value) || !isRecord(value.runtime))
    return taskRecordSchema.parse(value);
  if (value.runtime.version !== 3) return taskRecordSchema.parse(value);
  const migrated = { ...value };
  delete migrated.runtime;
  if (!terminalTaskStatuses.has(String(value.status))) {
    const migratedAt =
      typeof value.updatedAt === "string"
        ? value.updatedAt
        : new Date(0).toISOString();
    migrated.status = "interrupted";
    migrated.error =
      "Task was interrupted because its legacy worker runtime is no longer supported.";
    migrated.finishedAt = migratedAt;
  }
  return taskRecordSchema.parse(migrated);
}

function legacySuspensionId(checkpointId: string): string {
  return `suspension_${checkpointId.slice("checkpoint_".length)}`;
}

async function childDirectories(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function jsonLines(path: string): Promise<unknown[]> {
  const raw = await readFile(path, "utf8").catch(() => "");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as unknown);
}

function compareRunTransitions(
  left: RunTransitionRecord,
  right: RunTransitionRecord,
): number {
  if (left.runId === right.runId) return left.revision - right.revision;
  return (
    left.committedAt.localeCompare(right.committedAt) ||
    left.runId.localeCompare(right.runId) ||
    left.revision - right.revision
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
