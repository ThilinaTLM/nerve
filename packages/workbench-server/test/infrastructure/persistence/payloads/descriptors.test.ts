import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertNamespaceReferencesCovered,
  unregisteredNamespaceReferences,
} from "../../../../src/infrastructure/persistence/payloads/canonical-sweep.js";
import {
  DOMAIN_DOCUMENT_NAMESPACES,
  PAYLOAD_DESCRIPTORS,
  payloadDescriptor,
  resolvePayloadDescriptor,
} from "../../../../src/infrastructure/persistence/payloads/descriptors.js";

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
