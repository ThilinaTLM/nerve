import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  runTransitionRecordSchema,
  toolCallRecordSchema,
  toolCallTranscriptRecordSchema,
  type ToolCallRecord,
  type ToolInteraction,
} from "@nervekit/contracts";
import {
  pathExists,
  readJsonFile,
  rewriteJsonLines,
} from "../../storage/json.js";
import type { StorageMigration } from "../migration.js";
import { joinCanonicalPath } from "../canonical-path.js";
import { migrationChecksum } from "../checksum.js";

type LegacyRecord = Record<string, unknown>;
const archiveRoot = "migrations/archives/0006-unify-tool-call-lifecycle";
const legacyPaths = [
  "logs/tool-calls.jsonl",
  "approvals/approvals.jsonl",
  "user-questions/user-questions.jsonl",
  "plans/plan-reviews.jsonl",
];

async function conversationIds(home: string): Promise<string[]> {
  return (
    await readdir(join(home, "conversations"), { withFileTypes: true }).catch(
      () => [],
    )
  )
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("conv_"))
    .map((entry) => entry.name)
    .sort();
}

function hasCurrentToolIndex(
  context: Parameters<StorageMigration["detect"]>[0],
): boolean {
  return context.withDatabase((database) => {
    const columns = database
      .prepare("PRAGMA table_info(tool_calls)")
      .all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    const legacy = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('approvals', 'user_questions')",
      )
      .all();
    return (
      [
        "conversation_id",
        "project_id",
        "run_id",
        "status",
        "pending_interaction_kind",
        "revision",
        "json",
      ].every((name) => names.has(name)) && legacy.length === 0
    );
  });
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as LegacyRecord)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

const terminalRunStatuses = new Set([
  "completed",
  "failed",
  "cancelled",
  "cancellation_failed",
  "interrupted",
]);

async function archiveTerminalRuns(home: string): Promise<void> {
  const runsRoot = join(home, "run-runtime", "runs");
  const targetRoot = join(home, archiveRoot, "terminal-run-runtime");
  for (const directory of await readdir(runsRoot, {
    withFileTypes: true,
  }).catch(() => [])) {
    if (!directory.isDirectory()) continue;
    const source = join(runsRoot, directory.name);
    const state = await readJsonFile<LegacyRecord>(join(source, "state.json"));
    if (!terminalRunStatuses.has(String(state.status))) continue;
    await mkdir(targetRoot, { recursive: true, mode: 0o700 });
    await rename(source, join(targetRoot, directory.name));
  }
}

async function rewriteRunReferences(
  home: string,
  tools: Map<string, ToolCallRecord>,
): Promise<void> {
  const root = join(home, "run-runtime", "runs");
  for (const directory of await readdir(root, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (!directory.isDirectory()) continue;
    const path = join(root, directory.name, "transitions.jsonl");
    if (!(await pathExists(path))) continue;
    const transitions: LegacyRecord[] = [];
    const lines = createInterface({
      input: createReadStream(path, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    let line = 0;
    for await (const raw of lines) {
      line += 1;
      if (!raw.trim()) continue;
      let transition: LegacyRecord;
      try {
        transition = JSON.parse(raw) as LegacyRecord;
      } catch (error) {
        throw new Error(`Invalid run transition JSON at ${path}:${line}.`, {
          cause: error,
        });
      }
      transition.interactions = array(transition.interactions).map((item) =>
        migrateRunInteraction(item, tools),
      );
      transition.checkpoints = array(transition.checkpoints).map((item) => ({
        ...item,
        toolCalls: array(item.toolCalls).map((reference) => {
          const id = String(reference.toolCallId ?? "");
          return {
            toolCallId: id,
            revision:
              tools.get(id)?.revision ??
              Number(reference.revision ?? reference.lifecycleRevision ?? 1),
            status: reference.status,
          };
        }),
      }));
      transition.toolCalls = array(transition.toolCalls).map((item) => {
        const canonical =
          typeof item.id === "string" ? tools.get(item.id) : undefined;
        return canonical
          ? toolCallTranscriptRecordSchema.parse(canonical)
          : item;
      });
      transition.events = array(transition.events).map((event) =>
        migrateRunWaitingEvent(event, tools),
      );
      const unsigned = { ...transition };
      delete unsigned.checksum;
      transitions.push({
        ...unsigned,
        checksum: `sha256:${createHash("sha256").update(stable(unsigned)).digest("hex")}`,
      });
    }
    await rewriteJsonLines(path, transitions, 0o600);
  }
}

function array(value: unknown): LegacyRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is LegacyRecord => !!item && typeof item === "object",
      )
    : [];
}

function migrateRunInteraction(
  value: LegacyRecord,
  tools: Map<string, ToolCallRecord>,
): LegacyRecord {
  const toolCallId = String(value.toolCallId ?? "");
  const toolCall = tools.get(toolCallId);
  const kind = value.kind === "question" ? "user_input" : value.kind;
  const interaction = toolCall?.interactions.find(
    (candidate) => candidate.kind === kind,
  );
  if (!toolCall || !interaction)
    throw new Error(
      `Run interaction cannot resolve canonical tool reference '${toolCallId}'.`,
    );
  return {
    stateEpoch: value.stateEpoch,
    id: value.id,
    conversationId: value.conversationId,
    agentId: value.agentId,
    projectId: value.projectId,
    runId: value.runId,
    executionId: value.executionId,
    toolCallId,
    interactionOrdinal: interaction.ordinal,
    toolCallRevision: toolCall.revision,
    batchToolCallIds: value.batchToolCallIds,
    kind,
    status: value.status,
    resolutionRequestId: value.resolutionRequestId,
    resolutionHash: value.resolutionHash,
    resolution: value.resolution,
    checkpointId: value.checkpointId,
    createdAt: value.createdAt,
    resolvedAt: value.resolvedAt,
    cancelledAt: value.cancelledAt,
  };
}

function migrateRunWaitingEvent(
  value: LegacyRecord,
  tools: Map<string, ToolCallRecord>,
): LegacyRecord {
  if (
    value.type !== "run.waiting" ||
    !value.data ||
    typeof value.data !== "object"
  )
    return value;
  const data = value.data as LegacyRecord;
  const toolCallId = String(data.toolCallId ?? "");
  const toolCall = tools.get(toolCallId);
  const kind = data.waitKind === "input" ? "user_input" : data.waitKind;
  const interaction = toolCall?.interactions.find(
    (candidate) => candidate.kind === kind,
  );
  if (!toolCall || !interaction) return value;
  return {
    ...value,
    data: {
      conversationId: data.conversationId,
      agentId: data.agentId,
      runId: data.runId,
      waitKind: kind,
      interactionId: value.id,
      toolCallId,
      interactionOrdinal: interaction.ordinal,
      toolCallRevision: toolCall.revision,
      createdAt: data.createdAt,
    },
  };
}

async function mapConcurrent<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const value = values[cursor++];
        if (value !== undefined) await operation(value);
      }
    }),
  );
}

async function canonicalToolCalls(home: string) {
  const records = [];
  for (const conversationId of await conversationIds(home)) {
    const directory = join(home, "conversations", conversationId, "tool-calls");
    for (const file of await readdir(directory).catch(() => [])) {
      if (!file.endsWith(".json")) continue;
      records.push(
        toolCallRecordSchema.parse(await readJsonFile(join(directory, file))),
      );
    }
  }
  return records;
}

async function readLatest(
  path: string,
  key = "id",
  onMalformed?: (error: string, line: number) => void,
): Promise<Map<string, { record: LegacyRecord; count: number }>> {
  const records = new Map<string, { record: LegacyRecord; count: number }>();
  if (!(await pathExists(path))) return records;
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let line = 0;
  for await (const raw of lines) {
    line += 1;
    if (!raw.trim()) continue;
    let record: LegacyRecord;
    try {
      record = JSON.parse(raw) as LegacyRecord;
    } catch (error) {
      if (onMalformed) {
        onMalformed(
          error instanceof Error ? error.message : String(error),
          line,
        );
        continue;
      }
      throw new Error(
        `Migration input '${path}' has invalid JSON at line ${line}.`,
        { cause: error },
      );
    }
    const id = typeof record[key] === "string" ? record[key] : undefined;
    if (!id) {
      if (onMalformed) {
        onMalformed(`Missing ${key}`, line);
        continue;
      }
      throw new Error(
        `Migration input '${path}' has a row without ${key} at line ${line}.`,
      );
    }
    records.set(id, { record, count: (records.get(id)?.count ?? 0) + 1 });
  }
  return records;
}

function date(record: LegacyRecord, key: string, fallback: string): string {
  return typeof record[key] === "string" ? record[key] : fallback;
}

function interactionFromApproval(record: LegacyRecord): ToolInteraction {
  const requestedAt = date(record, "requestedAt", new Date(0).toISOString());
  const status = record.status === "pending" ? "pending" : "resolved";
  return {
    ordinal: 0,
    kind: "approval",
    status,
    requestedAt,
    updatedAt: date(record, "resolvedAt", requestedAt),
    ...(status === "resolved"
      ? { resolvedAt: date(record, "resolvedAt", requestedAt) }
      : {}),
    request: {
      risk: (record.risk ?? "interaction") as never,
      reason: String(record.reason ?? "Approval required"),
      offeredScopes: ["single_call"],
      suggestedExceptions: [],
    },
    ...(status === "resolved"
      ? {
          resolution: {
            action:
              record.status === "granted"
                ? ("allow" as const)
                : ("deny" as const),
            ...(typeof record.resolutionNote === "string"
              ? { note: record.resolutionNote }
              : {}),
          },
        }
      : {}),
  };
}

function interactionFromQuestion(record: LegacyRecord): ToolInteraction {
  const requestedAt = date(record, "requestedAt", new Date(0).toISOString());
  const pending = record.status === "pending";
  return {
    ordinal: 0,
    kind: "user_input",
    status: pending ? "pending" : "resolved",
    requestedAt,
    updatedAt: date(record, "updatedAt", requestedAt),
    ...(!pending
      ? {
          resolvedAt: date(
            record,
            "resolvedAt",
            date(record, "updatedAt", requestedAt),
          ),
        }
      : {}),
    request: {
      question: String(record.question ?? "Input requested"),
      ...(typeof record.context === "string"
        ? { context: record.context }
        : {}),
      ...(typeof record.recommendation === "string"
        ? { recommendation: record.recommendation }
        : {}),
      required: true,
    },
    ...(!pending
      ? {
          resolution:
            record.status === "answered"
              ? {
                  action: "answer" as const,
                  answer: String(record.answer ?? ""),
                }
              : {
                  action: "dismiss" as const,
                  reason: String(record.dismissedReason ?? "Dismissed"),
                },
        }
      : {}),
  };
}

function interactionFromReview(record: LegacyRecord): ToolInteraction {
  const requestedAt = date(record, "requestedAt", new Date(0).toISOString());
  const pending = record.status === "pending";
  const actionByStatus: Record<
    string,
    "accept" | "accept_in_new_chat" | "request_changes" | "discard"
  > = {
    accepted: "accept",
    accepted_in_new_chat: "accept_in_new_chat",
    changes_requested: "request_changes",
    discarded: "discard",
    force_exited: "discard",
  };
  return {
    ordinal: 0,
    kind: "plan_review",
    status: pending ? "pending" : "resolved",
    requestedAt,
    updatedAt: date(record, "updatedAt", requestedAt),
    ...(!pending
      ? {
          resolvedAt: date(
            record,
            "resolvedAt",
            date(record, "updatedAt", requestedAt),
          ),
        }
      : {}),
    request: {
      planPath: String(record.planPath ?? ""),
      slug: String(record.slug ?? "migrated-plan"),
      ...(typeof record.title === "string" ? { title: record.title } : {}),
      ...(typeof record.summary === "string"
        ? { summary: record.summary }
        : {}),
      allowNewConversation: true,
    },
    ...(!pending
      ? {
          resolution: {
            action: actionByStatus[String(record.status)] ?? "discard",
            ...(typeof record.feedback === "string"
              ? { feedback: record.feedback }
              : {}),
          },
        }
      : {}),
  };
}

function mapStatus(
  status: unknown,
  interactions: ToolInteraction[],
): "committed" | "waiting" | "running" | "completed" | "denied" | "failed" {
  const pending = interactions.some(
    (interaction) => interaction.status === "pending",
  );
  if (pending) return "waiting";
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "denied":
      return "denied";
    case "error":
      return "failed";
    case "pending_approval":
    case "waiting_for_user":
      return "running";
    default:
      return "committed";
  }
}

export const migration0006: StorageMigration = {
  id: "0006-unify-tool-call-lifecycle",
  description:
    "Unify tool calls and human interactions in conversation-scoped records",
  checksum: migrationChecksum(
    "0006-unify-tool-call-lifecycle|v3|Unify tool calls and human interactions in conversation-scoped records",
  ),
  async detect(context) {
    for (const relative of legacyPaths)
      if (await pathExists(join(context.paths.home, relative)))
        return "pending";
    for (const directory of ["approvals", "user-questions"])
      if (await pathExists(join(context.paths.home, directory)))
        return "pending";
    if (!hasCurrentToolIndex(context)) return "pending";
    if (await pathExists(join(context.paths.home, "run-runtime", "runs")))
      return "pending";
    for (const conversationId of await conversationIds(context.paths.home)) {
      const files = await readdir(
        join(context.paths.home, "conversations", conversationId, "tool-calls"),
      ).catch(() => []);
      for (const file of files.filter((name) => name.endsWith(".json"))) {
        const parsed = toolCallRecordSchema.safeParse(
          await readJsonFile(
            join(
              context.paths.home,
              "conversations",
              conversationId,
              "tool-calls",
              file,
            ),
          ),
        );
        if (!parsed.success) return "pending";
      }
    }
    return "current";
  },
  async backup(context) {
    const paths = [
      ...legacyPaths,
      "approvals",
      "user-questions",
      "run-runtime",
    ];
    for (const conversationId of await conversationIds(context.paths.home)) {
      paths.push(
        joinCanonicalPath("conversations", conversationId, "tool-calls"),
      );
    }
    paths.push(archiveRoot);
    return { paths };
  },
  async up(context) {
    const home = context.paths.home;
    const startedAt = performance.now();
    const timing = (stage: string) =>
      context.diagnostic(
        `Migration 0006 ${stage} (${Math.round(performance.now() - startedAt)}ms)`,
      );
    const tools = await readLatest(join(home, "logs", "tool-calls.jsonl"));
    timing("read legacy tool journal");
    const canonicalById = new Map(
      (await canonicalToolCalls(home)).map((record) => [record.id, record]),
    );
    timing("read existing canonical records");
    const migrated: ToolCallRecord[] = [];
    const grouped = new Map<string, ToolInteraction[]>();
    const orphaned: Array<{
      source: string;
      line?: number;
      legacyId?: string;
      error: string;
    }> = [];
    for (const [relative, convert] of [
      ["approvals/approvals.jsonl", interactionFromApproval],
      ["user-questions/user-questions.jsonl", interactionFromQuestion],
      ["plans/plan-reviews.jsonl", interactionFromReview],
    ] as const) {
      const source = join(home, relative);
      const latest = await readLatest(source, "id", (error, line) =>
        orphaned.push({ source: relative, line, error }),
      );
      for (const { record } of latest.values()) {
        const toolCallId =
          typeof record.toolCallId === "string" ? record.toolCallId : undefined;
        if (!toolCallId || !tools.has(toolCallId)) {
          orphaned.push({
            source: relative,
            legacyId: typeof record.id === "string" ? record.id : undefined,
            error: toolCallId
              ? `Missing tool call ${toolCallId}`
              : "Missing toolCallId",
          });
          continue;
        }
        grouped.set(toolCallId, [
          ...(grouped.get(toolCallId) ?? []),
          convert(record),
        ]);
      }
    }
    timing("read legacy interactions");
    for (const [id, value] of tools) {
      const legacy = value.record;
      const interactions = (grouped.get(id) ?? []).sort(
        (a, b) =>
          a.requestedAt.localeCompare(b.requestedAt) ||
          a.kind.localeCompare(b.kind),
      );
      let pendingSeen = false;
      for (let index = interactions.length - 1; index >= 0; index -= 1) {
        const interaction = interactions[index]!;
        interaction.ordinal = index;
        if (interaction.status !== "pending") continue;
        if (!pendingSeen) {
          pendingSeen = true;
          continue;
        }
        orphaned.push({
          source: "legacy-interaction-journals",
          legacyId: id,
          error: `Cancelled ambiguous pending ${interaction.kind} interaction`,
        });
        interaction.status = "cancelled";
        interaction.cancelledAt = context.now().toISOString();
        interaction.updatedAt = interaction.cancelledAt;
      }
      const status = mapStatus(legacy.status, interactions);
      const updatedAt = date(
        legacy,
        "updatedAt",
        date(legacy, "createdAt", context.now().toISOString()),
      );
      const record = toolCallRecordSchema.parse({
        ...legacy,
        status,
        revision: Math.max(1, value.count),
        attempt:
          legacy.status === "running" ||
          legacy.status === "completed" ||
          legacy.status === "error"
            ? 1
            : 0,
        interactions,
        ...(status === "failed" && typeof legacy.error !== "string"
          ? { error: "Migrated legacy tool failure." }
          : {}),
        ...(["completed", "denied", "failed"].includes(status)
          ? { settledAt: updatedAt }
          : {}),
      });
      migrated.push(record);
      canonicalById.set(record.id, record);
    }
    timing("normalize canonical records");
    await mapConcurrent(migrated, 64, async (record) => {
      const directory = join(
        home,
        "conversations",
        record.conversationId,
        "tool-calls",
      );
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // The batch rollback bundle makes partial migration output disposable.
      // Avoid one filesystem transaction per record during this one-time bulk
      // import; normal repository updates remain atomic and fsynced.
      await writeFile(
        join(directory, `${record.id}.json`),
        `${JSON.stringify(record, null, 2)}\n`,
        { mode: 0o600 },
      );
    });
    timing("write canonical records");
    if (orphaned.length > 0) {
      await rewriteJsonLines(
        join(home, archiveRoot, "orphaned-interactions.jsonl"),
        orphaned,
        0o600,
      );
    }
    const canonical = [...canonicalById.values()];
    timing("write interaction archive");
    await archiveTerminalRuns(home);
    timing("archive terminal runs");
    await rewriteRunReferences(
      home,
      new Map(canonical.map((record) => [record.id, record])),
    );
    timing("rewrite active run references");
    context.transaction((database) => {
      database.exec(`
        DROP TABLE IF EXISTS tool_calls;
        DROP TABLE IF EXISTS approvals;
        DROP TABLE IF EXISTS user_questions;
        CREATE TABLE tool_calls (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, project_id TEXT NOT NULL,
          run_id TEXT, status TEXT NOT NULL, pending_interaction_kind TEXT,
          revision INTEGER NOT NULL, json TEXT NOT NULL
        );
        CREATE INDEX tool_calls_conversation ON tool_calls(conversation_id);
        CREATE INDEX tool_calls_project ON tool_calls(project_id);
        CREATE INDEX tool_calls_run ON tool_calls(run_id);
        CREATE INDEX tool_calls_status ON tool_calls(status);
        CREATE INDEX tool_calls_pending_interaction ON tool_calls(pending_interaction_kind);
        DELETE FROM index_meta WHERE key LIKE 'tool_calls_%' OR key = 'schema_version';
      `);
      const insert = database.prepare(`INSERT INTO tool_calls (
        id, conversation_id, project_id, run_id, status,
        pending_interaction_kind, revision, json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const record of canonical)
        insert.run(
          record.id,
          record.conversationId,
          record.projectId,
          record.runId ?? null,
          record.status,
          record.interactions.find(
            (interaction) => interaction.status === "pending",
          )?.kind ?? null,
          record.revision,
          JSON.stringify(record),
        );
    });
    timing("rebuild tool-call index");
    for (const relative of legacyPaths)
      await rm(join(home, relative), { force: true });
    for (const directory of ["approvals", "user-questions"])
      await rm(join(home, directory), { recursive: true, force: true });
  },
  async verify(context) {
    if (!hasCurrentToolIndex(context))
      throw new Error("Current tool-call index shape is missing.");
    const runsRoot = join(context.paths.home, "run-runtime", "runs");
    for (const directory of await readdir(runsRoot, {
      withFileTypes: true,
    }).catch(() => [])) {
      if (!directory.isDirectory()) continue;
      const path = join(runsRoot, directory.name, "transitions.jsonl");
      let line = 0;
      for await (const raw of createInterface({
        input: createReadStream(path, { encoding: "utf8" }),
        crlfDelay: Infinity,
      })) {
        line += 1;
        if (!raw.trim()) continue;
        const parsed = runTransitionRecordSchema.safeParse(JSON.parse(raw));
        if (!parsed.success)
          throw new Error(
            `Migrated run transition is invalid at ${path}:${line}.`,
          );
      }
    }
    for (const relative of legacyPaths)
      if (await pathExists(join(context.paths.home, relative)))
        throw new Error(`Legacy tool path '${relative}' remains.`);
    for (const directory of ["approvals", "user-questions"])
      if (await pathExists(join(context.paths.home, directory)))
        throw new Error(`Legacy interaction directory '${directory}' remains.`);
    const canonicalPaths: string[] = [];
    for (const conversationId of await conversationIds(context.paths.home)) {
      const directory = join(
        context.paths.home,
        "conversations",
        conversationId,
        "tool-calls",
      );
      for (const file of await readdir(directory).catch(() => [])) {
        if (file.endsWith(".json")) canonicalPaths.push(join(directory, file));
      }
    }
    await mapConcurrent(canonicalPaths, 64, async (path) => {
      toolCallRecordSchema.parse(await readJsonFile(path));
    });
  },
};
