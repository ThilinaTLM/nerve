import { createJsonPayloadCodec, type PayloadCodec } from "./codec.js";
import { isJsonObject } from "./merge.js";
import { toolCallPayloadCodec } from "./tool-call/upgraders.js";

export type PayloadDatabase = "canonical" | "query-cache";
export type PayloadRecordClass = "derived" | "user-content";
export type PayloadQuarantineUnit = "record" | "conversation";

export interface PayloadLocation {
  readonly database: PayloadDatabase;
  readonly table: string;
  readonly column: string;
  /** A domain_documents namespace, when the table is namespace multiplexed. */
  readonly namespace?: string;
  /** A table discriminator such as conversation_records.kind. */
  readonly discriminator?: Readonly<{
    column: string;
    value: string;
  }>;
}

export type PayloadVersionSource =
  | { readonly kind: "column"; readonly column: string }
  | { readonly kind: "constant"; readonly version: number };

export interface PayloadDescriptor<T = unknown> {
  readonly id: string;
  readonly location: PayloadLocation;
  readonly keyColumns: readonly string[];
  readonly recordClass: PayloadRecordClass;
  readonly quarantineUnit: PayloadQuarantineUnit;
  readonly version: PayloadVersionSource;
  readonly codec: PayloadCodec<T>;
  /** Whether the codec has a current persisted read schema or only JSON framing. */
  readonly validation: "read-schema" | "json-only";
}

const jsonV1Codec = createJsonPayloadCodec({
  currentVersion: 1,
  read: (value) => value,
});

const toolCallEnvelopeCodec = createJsonPayloadCodec({
  currentVersion: 2,
  upgraders: { 1: (value) => value },
  read: (value) => {
    if (!isJsonObject(value) || !("toolCall" in value)) {
      throw new Error("Stored tool-call record must contain toolCall.");
    }
    return {
      ...value,
      toolCall: toolCallPayloadCodec.read(
        toolCallPayloadCodec.upgrade(value.toolCall, 1),
      ),
    };
  },
});

const versionColumn = {
  kind: "column",
  column: "payload_version",
} as const;
const versionOne = { kind: "constant", version: 1 } as const;

function canonicalDescriptor(
  id: string,
  table: string,
  keyColumns: readonly string[],
  options: {
    column?: string;
    recordClass?: PayloadRecordClass;
    quarantineUnit?: PayloadQuarantineUnit;
    version?: PayloadVersionSource;
    discriminator?: PayloadLocation["discriminator"];
    codec?: PayloadCodec;
    validation?: PayloadDescriptor["validation"];
  } = {},
): PayloadDescriptor {
  return {
    id,
    location: {
      database: "canonical",
      table,
      column: options.column ?? "data",
      ...(options.discriminator
        ? { discriminator: options.discriminator }
        : {}),
    },
    keyColumns,
    recordClass: options.recordClass ?? "derived",
    quarantineUnit: options.quarantineUnit ?? "record",
    version: options.version ?? versionColumn,
    codec: options.codec ?? jsonV1Codec,
    validation: options.validation ?? "json-only",
  };
}

function domainDocumentDescriptor(
  namespace: DomainDocumentNamespace,
  recordClass: PayloadRecordClass,
  quarantineUnit: PayloadQuarantineUnit = "record",
): PayloadDescriptor {
  return {
    ...canonicalDescriptor(
      `domain-document:${namespace}`,
      "domain_documents",
      ["namespace", "scope_id", "document_id"],
      { recordClass, quarantineUnit },
    ),
    location: {
      database: "canonical",
      table: "domain_documents",
      column: "data",
      namespace,
    },
  };
}

/** Namespaces written by current repositories and canonical journal storage. */
export const DOMAIN_DOCUMENT_NAMESPACES = [
  "agent",
  "async-subagent-assignment",
  "async-subagent-control",
  "canonical_data_migration",
  "conversation",
  "conversation_deletion",
  "conversation_journal_commit",
  "conversation_journal_head",
  "conversation_state",
  "maintenance",
  "project",
  "project-capability-trust",
  "project-permission-trust",
  "prompt_suggestion_enablement",
  "prompt_suggestion_trust",
  "scratch_notes",
  "task",
  "task_definitions",
] as const;
export type DomainDocumentNamespace =
  (typeof DOMAIN_DOCUMENT_NAMESPACES)[number];

const userDocumentNamespaces = new Set<DomainDocumentNamespace>([
  "agent",
  "conversation",
  "conversation_journal_commit",
  "conversation_state",
  "project",
  "scratch_notes",
  "task",
  "task_definitions",
]);
const conversationUnitNamespaces = new Set<DomainDocumentNamespace>([
  "conversation_journal_commit",
  "conversation_journal_head",
  "conversation_state",
]);

const conversationRecordDescriptors = [
  "message",
  "summary",
  "run",
  "tool_call",
  "tool_batch",
].map((kind) =>
  canonicalDescriptor(
    `conversation-record:${kind}`,
    "conversation_records",
    ["id"],
    {
      recordClass: "user-content",
      quarantineUnit: "conversation",
      discriminator: { column: "kind", value: kind },
      ...(kind === "tool_call"
        ? {
            codec: toolCallEnvelopeCodec,
            validation: "read-schema" as const,
          }
        : {}),
    },
  ),
);

const conversationProjectionDescriptors = ["message", "summary", "run"].map(
  (kind) =>
    canonicalDescriptor(
      `conversation-record-projection:${kind}`,
      "conversation_record_projections",
      ["record_id"],
      { discriminator: { column: "kind", value: kind } },
    ),
);

const domainDocumentDescriptors = DOMAIN_DOCUMENT_NAMESPACES.map((namespace) =>
  domainDocumentDescriptor(
    namespace,
    userDocumentNamespaces.has(namespace) ? "user-content" : "derived",
    conversationUnitNamespaces.has(namespace) ? "conversation" : "record",
  ),
);

const canonicalPayloadDescriptors: readonly PayloadDescriptor[] = [
  ...conversationRecordDescriptors,
  ...conversationProjectionDescriptors,
  canonicalDescriptor("durable-event", "durable_events", ["row_id"]),
  canonicalDescriptor(
    "rpc-idempotency-outcome",
    "rpc_idempotency",
    ["scope", "key"],
    {
      column: "outcome",
      version: versionOne,
    },
  ),
  ...domainDocumentDescriptors,
  canonicalDescriptor("lifecycle-work", "lifecycle_work", ["id"]),
  canonicalDescriptor(
    "lifecycle-command-receipt",
    "lifecycle_command_receipts",
    ["scope_id", "request_id"],
  ),
  canonicalDescriptor("reconciliation-operation", "reconciliation_operations", [
    "id",
  ]),
  canonicalDescriptor("run-lifecycle-record", "run_lifecycle_records", [
    "run_id",
  ]),
  canonicalDescriptor("lifecycle-tool-proposal", "lifecycle_tool_proposals", [
    "proposal_id",
  ]),
  canonicalDescriptor("lifecycle-interaction", "lifecycle_interactions", [
    "interaction_id",
  ]),
  canonicalDescriptor(
    "lifecycle-execution-attempt",
    "lifecycle_execution_attempts",
    ["attempt_id"],
  ),
  canonicalDescriptor("lifecycle-recovery-issue", "lifecycle_recovery_issues", [
    "issue_id",
  ]),
  canonicalDescriptor("agent-async-obligation", "agent_async_obligations", [
    "id",
  ]),
  canonicalDescriptor(
    "subagent-completion",
    "subagent_completions",
    ["run_id"],
    {
      version: versionOne,
    },
  ),
];

const queryCachePayloadDescriptors: readonly PayloadDescriptor[] = [
  ["project", "projects", "id"],
  ["conversation", "conversations", "id"],
  ["agent", "agents", "id"],
  ["task", "tasks", "id"],
  ["prompt-suggestion-trust", "prompt_suggestion_trust", "trust_id"],
].map(([id, table, key]) => ({
  id: `query-cache:${id}`,
  location: { database: "query-cache", table, column: "json" },
  keyColumns: [key],
  recordClass: "derived",
  quarantineUnit: "record",
  version: versionOne,
  codec: jsonV1Codec,
  validation: "json-only",
}));

/**
 * Complete static registry for JSON/BLOB payload columns currently persisted by
 * the canonical and runtime query-cache databases. This is metadata only; the
 * database read path and migration sweep must opt in to dispatching through it.
 */
export const PAYLOAD_DESCRIPTORS: readonly PayloadDescriptor[] = Object.freeze([
  ...canonicalPayloadDescriptors,
  ...queryCachePayloadDescriptors,
]);

export interface PayloadDescriptorLookup {
  readonly database: PayloadDatabase;
  readonly table: string;
  readonly column: string;
  readonly namespace?: string;
  readonly discriminators?: Readonly<Record<string, unknown>>;
}

export function payloadDescriptor(id: string): PayloadDescriptor | undefined {
  return PAYLOAD_DESCRIPTORS.find((descriptor) => descriptor.id === id);
}

/** Resolve row metadata to one codec; callers remain responsible for reading bytes/version. */
export function resolvePayloadDescriptor(
  lookup: PayloadDescriptorLookup,
): PayloadDescriptor | undefined {
  const matches = PAYLOAD_DESCRIPTORS.filter(({ location }) => {
    if (
      location.database !== lookup.database ||
      location.table !== lookup.table ||
      location.column !== lookup.column
    ) {
      return false;
    }
    if (location.namespace !== lookup.namespace) return false;
    return location.discriminator
      ? lookup.discriminators?.[location.discriminator.column] ===
          location.discriminator.value
      : true;
  });
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous payload descriptor for ${lookup.database}:${lookup.table}.${lookup.column}.`,
    );
  }
  return matches[0];
}
