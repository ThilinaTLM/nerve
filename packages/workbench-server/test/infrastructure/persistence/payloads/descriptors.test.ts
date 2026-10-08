import type { AgentInputRecord } from "@nervekit/contracts/agents";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertNamespaceReferencesCovered,
  assertPayloadDescriptorCoverage,
  decodeCanonicalPayloadRecords,
  unregisteredNamespaceReferences,
} from "../../../../src/infrastructure/persistence/payloads/canonical-sweep.js";
import {
  DOMAIN_DOCUMENT_NAMESPACES,
  PAYLOAD_DESCRIPTORS,
  payloadDescriptor,
  resolvePayloadDescriptor,
} from "../../../../src/infrastructure/persistence/payloads/descriptors.js";
import {
  CANONICAL_SCHEMA_SQL,
  CANONICAL_MIGRATIONS,
} from "../../../../src/infrastructure/persistence/canonical-sqlite/schema.js";
import { canonicalPayloadSweepDescriptors } from "../../../../src/infrastructure/storage-migrations/runner/payload-sweep.js";
import { sweepStorageReadability } from "../../../../src/infrastructure/storage-migrations/runner/sweep.js";

describe("payload descriptor registry", () => {
  it("has stable unique ids and locations for every descriptor", () => {
    assert.equal(
      new Set(PAYLOAD_DESCRIPTORS.map(({ id }) => id)).size,
      PAYLOAD_DESCRIPTORS.length,
    );
    for (const descriptor of PAYLOAD_DESCRIPTORS) {
      assert.ok(descriptor.id);
      assert.ok(descriptor.location.table);
      assert.ok(descriptor.location.column);
      assert.ok(descriptor.keyColumns.length > 0);
      assert.ok(descriptor.codec.currentVersion > 0);
    }
  });

  it("enumerates every canonical payload table and domain namespace", () => {
    const canonicalLocations = new Set(
      PAYLOAD_DESCRIPTORS.filter(
        ({ location }) => location.database === "canonical",
      ).map(({ location }) => `${location.table}.${location.column}`),
    );
    assert.deepEqual([...canonicalLocations].sort(), [
      "agent_async_obligations.data",
      "artifact_manifests.data",
      "conversation_record_projections.data",
      "conversation_records.data",
      "domain_documents.data",
      "durable_events.data",
      "exact_call_authorizations.data",
      "lifecycle_command_receipts.data",
      "lifecycle_execution_attempts.data",
      "lifecycle_interactions.data",
      "lifecycle_recovery_issues.data",
      "lifecycle_tool_proposals.data",
      "lifecycle_work.data",
      "reconciliation_operations.data",
      "restore_promotions.data",
      "rpc_idempotency.outcome",
      "run_lifecycle_records.data",
      "subagent_completions.data",
      "transcript_projection_rows.data",
    ]);

    const registeredNamespaces = PAYLOAD_DESCRIPTORS.flatMap(({ location }) =>
      location.namespace === undefined ? [] : [location.namespace],
    );
    assert.deepEqual(registeredNamespaces, [...DOMAIN_DOCUMENT_NAMESPACES]);
  });

  it("covers statically discoverable domain-document namespace references", () => {
    const sourceRoot = join(import.meta.dirname, "../../../../src");
    const sources = [
      join(sourceRoot, "domains"),
      join(sourceRoot, "app"),
      join(sourceRoot, "infrastructure", "migrations"),
      join(sourceRoot, "infrastructure", "persistence", "canonical-sqlite"),
      join(sourceRoot, "infrastructure", "storage-migrations"),
    ].flatMap(readTypeScriptSources);
    assert.doesNotThrow(() =>
      assertNamespaceReferencesCovered(
        sources.map((path) => readFileSync(path, "utf8")),
      ),
    );
  });

  it("discovers namespaces declared by bare and prefixed NAMESPACE constants", () => {
    assert.deepEqual(
      unregisteredNamespaceReferences([
        'const NAMESPACE = "bare-namespace";',
        'const TASK_NAMESPACE = "prefixed-namespace";',
      ]),
      ["bare-namespace", "prefixed-namespace"],
    );
  });

  it("validates durable input receipts and tombstones without changing old v1 documents", () => {
    const codec = payloadDescriptor("domain-document:agent_inputs")!.codec;
    const current = queueDocument();
    assert.deepEqual(codec.decode(codec.encode(current), 1), current);
    assert.doesNotThrow(() => codec.validate(codec.encode(current), 1));
    const old = { revision: 0, nextSequence: 0, paused: false, inputs: [] };
    assert.deepEqual(codec.decode(Buffer.from(JSON.stringify(old)), 1), old);
    assert.throws(
      () => codec.decode(codec.encode(current), 2),
      /newer than supported/,
    );
    assert.throws(
      () => codec.decode(codec.encode(current), 0),
      /positive safe integer/,
    );
  });

  it("fails closed on corrupt input authority, targeting, ordering and delivery instead of filling acceptance defaults", () => {
    const codec = payloadDescriptor("domain-document:agent_inputs")!.codec;
    const invalid = [
      (queue: ReturnType<typeof queueDocument>) => {
        delete (queue.inputs[0] as Partial<(typeof queue.inputs)[number]>)
          .activation;
      },
      (queue: ReturnType<typeof queueDocument>) => {
        delete (queue.inputs[0] as Partial<(typeof queue.inputs)[number]>)
          .eligibility;
      },
      (queue: ReturnType<typeof queueDocument>) => {
        queue.inputs[1]!.delivery!.contextEntryId = "entry_wrong";
      },
      (queue: ReturnType<typeof queueDocument>) => {
        queue.inputs[1]!.sequence = 0;
      },
      (queue: ReturnType<typeof queueDocument>) => {
        queue.inputs[0]!.agentId = "agent_other";
      },
      (queue: ReturnType<typeof queueDocument>) => {
        queue.inputs[0]!.role = "system";
      },
      (queue: ReturnType<typeof queueDocument>) => {
        queue.insertionClaims.input_pending.agentId = "agent_other";
      },
      (queue: ReturnType<typeof queueDocument>) => {
        queue.wakeRequested = true;
      },
    ];
    for (const corrupt of invalid) {
      const queue = queueDocument();
      corrupt(queue);
      const bytes = Buffer.from(JSON.stringify(queue));
      assert.throws(() => codec.decode(bytes, 1));
      assert.throws(() => codec.validate(bytes, 1));
    }
  });

  it("preserves complete frozen context seed envelopes and binding compatibility fields", () => {
    const seed = prefixDocument();
    const prefix = payloadDescriptor(
      "domain-document:agent-context-prefix-migration",
    )!.codec;
    assert.deepEqual(prefix.decode(prefix.encode(seed), 1), seed);
    assert.throws(() =>
      prefix.validate(
        Buffer.from(JSON.stringify({ ...seed, sourceRevision: -1 })),
        1,
      ),
    );
    assert.throws(() =>
      prefix.validate(
        Buffer.from(
          JSON.stringify({
            ...seed,
            entries: [{ ...seed.entries[0], parentId: "wrong" }],
          }),
        ),
        1,
      ),
    );
    const binding = payloadDescriptor(
      "domain-document:agent-context-binding",
    )!.codec;
    const identity = {
      legacyRootAgentId: "agent_deleted_lead",
      canonicalRoot: true,
      contextOwnerAgentId: null,
    };
    assert.deepEqual(binding.decode(binding.encode(identity), 1), identity);
    assert.throws(() =>
      binding.validate(Buffer.from('{"legacyRootAgentId":"wrong"}'), 1),
    );
    // Do not reinterpret existing agent documents or legacy owner compatibility
    // fields merely because new narrow namespace codecs are registered.
    const agent = payloadDescriptor("domain-document:agent")!.codec;
    for (const contextOwnerAgentId of [null, "agent_owned"]) {
      const original = {
        id: "agent_owned",
        executionKind: "root",
        canonicalRoot: true,
        contextOwnerAgentId,
      };
      assert.deepEqual(agent.decode(agent.encode(original), 1), original);
    }
  });

  it("covers and decodes actual canonical BLOB rows for the new authorities, and reports corrupt queue rows as user content", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-agent-payloads-"));
    const database = new DatabaseSync(join(home, "canonical.sqlite"));
    try {
      database.exec(CANONICAL_SCHEMA_SQL);
      for (const migration of CANONICAL_MIGRATIONS)
        database.exec(migration.sql);
      const documents = [
        {
          namespace: "agent-context-binding",
          scope: "global",
          id: "conv_test",
          data: { legacyRootAgentId: "agent_deleted_lead" },
        },
        {
          namespace: "agent-context-prefix-migration",
          scope: "conv_test",
          id: "agent_test",
          data: prefixDocument(),
        },
        {
          namespace: "agent_inputs",
          scope: "global",
          id: "agent_test",
          data: queueDocument(),
        },
      ];
      const insert = database.prepare(`INSERT INTO domain_documents
        (namespace, scope_id, document_id, revision, payload_version, data, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, 3, 1, ?, 0, 0)`);
      for (const document of documents)
        insert.run(
          document.namespace,
          document.scope,
          document.id,
          Buffer.from(JSON.stringify(document.data)),
        );
      assert.doesNotThrow(() => assertPayloadDescriptorCoverage(database));
      const decoded = [...decodeCanonicalPayloadRecords(database)].filter(
        (record) =>
          documents.some(
            ({ namespace }) =>
              record.descriptor.location.namespace === namespace,
          ),
      );
      assert.equal(decoded.length, documents.length);
      for (const document of documents) {
        const record = decoded.find(
          ({ descriptor }) =>
            descriptor.location.namespace === document.namespace,
        )!;
        assert.deepEqual(record.value, document.data);
        assert.equal(record.descriptor.validation, "read-schema");
        assert.equal(record.descriptor.recordClass, "user-content");
        assert.deepEqual(record.key, {
          namespace: document.namespace,
          scope_id: document.scope,
          document_id: document.id,
        });
      }
      assert.deepEqual(
        sweepStorageReadability(database, canonicalPayloadSweepDescriptors())
          .failures,
        [],
      );
      const corrupt = queueDocument();
      corrupt.inputs[1]!.delivery!.contextEntryId = "entry_wrong";
      database
        .prepare(
          "UPDATE domain_documents SET data = ? WHERE namespace = 'agent_inputs'",
        )
        .run(Buffer.from(JSON.stringify(corrupt)));
      const failures = sweepStorageReadability(
        database,
        canonicalPayloadSweepDescriptors(),
      ).failures;
      assert.equal(failures.length, 1);
      assert.equal(failures[0]?.descriptorId, "domain-document:agent_inputs");
      assert.equal(failures[0]?.recordClass, "user-content");
    } finally {
      database.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("marks the known tool-call upgrade path without implying global dispatch", () => {
    const descriptor = payloadDescriptor("conversation-record:tool_call");
    assert.ok(descriptor);
    assert.equal(descriptor.codec.currentVersion, 2);
    assert.equal(descriptor.validation, "read-schema");
    assert.deepEqual(descriptor.location.discriminator, {
      column: "kind",
      value: "tool_call",
    });
    assert.equal(
      resolvePayloadDescriptor({
        database: "canonical",
        table: "conversation_records",
        column: "data",
        discriminators: { kind: "tool_call" },
      })?.id,
      descriptor.id,
    );
  });
});

function readTypeScriptSources(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return readTypeScriptSources(child);
    return entry.isFile() && entry.name.endsWith(".ts") ? [child] : [];
  });
}

function queueDocument() {
  const timestamp = "2026-01-02T03:04:05.000Z";
  const base = {
    agentId: "agent_test",
    conversationId: "conv_test",
    role: "user" as const,
    origin: { kind: "user" as const, userId: "authorized" },
    text: "preserved accepted text",
    eligibility: { kind: "next_turn" as const },
    activation: "queue_only" as const,
    acceptedAt: timestamp,
  };
  const inputs: AgentInputRecord[] = [
    {
      ...base,
      id: "input_pending",
      sequence: 0,
      idempotencyKey: "pending",
      state: "pending",
    },
    {
      ...base,
      id: "input_delivered",
      sequence: 1,
      idempotencyKey: "delivered",
      state: "delivered",
      delivery: {
        runId: "run_test",
        attemptId: "exec_test",
        turnId: "turn_test",
        contextEntryId: "entry_input_delivered",
        deliveredAt: timestamp,
      },
    },
    {
      ...base,
      id: "input_cancelled",
      sequence: 2,
      idempotencyKey: "cancelled",
      state: "cancelled",
      eligibility: { kind: "next_run", afterRunId: "run_previous" },
    },
    {
      ...base,
      id: "input_obsolete",
      sequence: 3,
      idempotencyKey: "obsolete",
      state: "obsolete",
      eligibility: { kind: "run", runId: "run_ended" },
    },
  ];
  return {
    revision: 3,
    nextSequence: 4,
    paused: true,
    wakeRequested: false,
    contextPending: true,
    controlGeneration: 2,
    inputs,
    acceptedEligibilities: Object.fromEntries(
      inputs.map((input) => [input.id, input.eligibility]),
    ),
    insertionClaims: {
      input_pending: {
        agentId: "agent_test",
        conversationId: "conv_test",
        runId: "run_test",
        attemptId: "exec_test",
        turnId: "turn_test",
        requiresProvider: true,
      },
    },
  };
}

function prefixDocument() {
  return {
    sourceRevision: 12,
    leafId: "entry_detached",
    entries: [
      {
        type: "message",
        id: "entry_root",
        parentId: null,
        timestamp: "2026-01-02T03:04:05.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "historical prefix" }],
        },
      },
      {
        type: "message",
        id: "entry_active",
        parentId: "entry_root",
        timestamp: "2026-01-02T03:04:06.000Z",
        // Model entry payloads are opaque; do not flatten pending-input envelopes
        // or reinterpret a stored message's role while validating the seed.
        message: {
          type: "StoredPendingInputContext",
          id: "input_pending",
          message: { role: "user", content: "original queued content" },
          origin: {
            kind: "system",
            producer: "task_notification",
            correlationId: "task_test:terminal",
          },
        },
      },
      {
        type: "message",
        id: "entry_detached",
        parentId: "entry_root",
        timestamp: "2026-01-02T03:04:07.000Z",
        message: { role: "assistant", content: "detached branch" },
      },
    ],
  };
}
