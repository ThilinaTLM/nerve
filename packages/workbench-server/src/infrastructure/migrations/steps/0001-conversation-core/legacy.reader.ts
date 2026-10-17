import { dependentUnits } from "../../framework/toolkit.js";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { StepContext, DiscardableItem } from "../../framework/step.js";
import { createHash } from "node:crypto";
import type { SelectedPathVerification } from "./selected-path.validation.js";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

// The archive contains several historical payload versions. Only the destination
// schemas are authoritative; keeping the loose shape here avoids legacy imports.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Legacy = Record<string, any>;
export type LegacyRow = Record<string, SQLOutputValue>;

export function decode(value: SQLOutputValue): Legacy {
  return JSON.parse(
    typeof value === "string"
      ? value
      : Buffer.from(value as Uint8Array).toString("utf8"),
  );
}

export function iso(
  value: unknown,
  fallback = new Date().toISOString(),
): string {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

export class ImportIds {
  private readonly ids = new Map<string, string>();
  get(prefix: string, old: string): string {
    const key = `${prefix}:${old}`;
    let id = this.ids.get(key);
    if (!id) {
      id = old.startsWith(`${prefix}_`)
        ? old
        : `${prefix}_0${createHash("sha256").update(key).digest("hex").slice(0, 25).toUpperCase()}`;
      this.ids.set(key, id);
    }
    return id;
  }
}

export class LegacyReader {
  readonly db: DatabaseSync;
  readonly failures: DiscardableItem[] = [];
  constructor(
    path: string,
    readonly context?: StepContext,
  ) {
    this.db = new DatabaseSync(path, { readOnly: true });
    this.db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000");
  }
  *documents(namespace: string): Generator<{ row: LegacyRow; data: Legacy }> {
    // Never enumerate the document table without a namespace predicate: the
    // conversation_state snapshots alone can be hundreds of MB per row.
    for (const row of this.db
      .prepare("SELECT * FROM domain_documents WHERE namespace = ?")
      .iterate(namespace)) {
      const id = `legacy-record:${namespace}/${row.document_id}`;
      if (this.context?.discarded.has(id)) {
        this.context.quarantine(
          {
            kind: "configuration",
            id,
            title: this.title(namespace),
            reason: "Unreadable legacy record set aside at user request",
          },
          this.payload(namespace, row),
        );
        continue;
      }
      let data: Legacy;
      try {
        data = decode(row.data);
        if (!data || typeof data !== "object")
          throw new Error("Expected a JSON object");
        if (
          namespace === "project" &&
          (typeof data.id !== "string" ||
            typeof (data.dir ?? data.directory) !== "string")
        )
          throw new Error("Project has no ID or directory");
        if (namespace === "project" && !isAbsolute(data.dir ?? data.directory))
          throw new Error("Project directory must be absolute");
        if (
          namespace === "agent" &&
          (typeof data.id !== "string" ||
            typeof data.conversationId !== "string")
        )
          throw new Error("Agent has no ID or conversation owner");
        if (
          namespace === "task" &&
          (typeof data.id !== "string" || typeof data.origin?.kind !== "string")
        )
          throw new Error("Task has no ID or origin");
        if (
          namespace === "agent_inputs" &&
          (!Array.isArray(data.inputs) ||
            data.inputs.some(
              (input: Legacy) =>
                !input ||
                typeof input.id !== "string" ||
                typeof input.conversationId !== "string",
            ))
        )
          throw new Error("Queued inputs must be a list");
        if (
          namespace === "agent_input_preparation" &&
          typeof data.inputId !== "string"
        )
          throw new Error("Input preparation has no input ID");
      } catch (error) {
        if (!this.context) throw error;
        const owners = this.recordOwners(namespace, row);
        const reason = `Unreadable ${namespace} ${row.document_id} record: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
        const items: DiscardableItem[] = owners.length
          ? owners.map((owner) => ({ kind: "conversation", id: owner, reason }))
          : [
              {
                kind: "configuration",
                id,
                title: this.title(namespace),
                reason,
              },
            ];
        if (namespace === "project") {
          dependentUnits(this.context, id, owners);
          items.unshift({
            kind: "configuration",
            id,
            title: "Project settings",
            reason,
          });
        }
        for (const item of items) {
          if (this.context.discarded.has(item.id)) {
            this.context.quarantine(item, this.payload(namespace, row));
          } else if (!this.failures.some((failed) => failed.id === item.id))
            this.failures.push(item);
        }
        continue;
      }
      yield { row, data };
    }
  }
  private payload(namespace: string, row: LegacyRow) {
    const path =
      this.context &&
      namespace === "task" &&
      /^task_[A-Za-z0-9_-]+$/.test(String(row.document_id))
        ? join(this.context.paths.dataPath, "tasks", String(row.document_id))
        : undefined;
    return {
      records: [{ table: "domain_documents", row }],
      files: path && existsSync(path) ? [path] : [],
    };
  }
  private title(namespace: string): string {
    return (
      (
        {
          prompt_suggestion_enablement: "Prompt suggestion settings",
          prompt_suggestion_trust: "Prompt suggestion trust",
          task_definitions: "Project launch definitions",
          project: "Project settings",
        } as Record<string, string>
      )[namespace] ?? `Legacy ${namespace.replaceAll("_", " ")} settings`
    );
  }
  recordOwners(namespace: string, row: LegacyRow): string[] {
    const owners = new Set<string>();
    if (String(row.scope_id).startsWith("conv_"))
      owners.add(String(row.scope_id));
    const key = String(row.document_id);
    if (["agent", "agent_inputs"].includes(namespace)) {
      for (const record of this.db
        .prepare(
          "SELECT DISTINCT conversation_id FROM conversation_records WHERE agent_id = ?",
        )
        .all(key))
        owners.add(String(record.conversation_id));
      for (const record of this.db
        .prepare(
          "SELECT DISTINCT conversation_id FROM agent_context_leaves WHERE agent_id = ?",
        )
        .all(key))
        owners.add(String(record.conversation_id));
    }
    for (const record of this.db
      .prepare(
        "SELECT document_id, data FROM domain_documents WHERE namespace = 'conversation'",
      )
      .iterate()) {
      try {
        const conversation = decode(record.data);
        if (
          (namespace === "project" && conversation.projectId === key) ||
          (["agent", "agent_inputs"].includes(namespace) &&
            conversation.activeAgentId === key)
        )
          owners.add(String(record.document_id));
      } catch {
        /* The conversation is independently attributed by conversations(). */
      }
    }
    if (["task", "agent_input_preparation"].includes(namespace)) {
      for (const record of this.db
        .prepare(
          "SELECT DISTINCT conversation_id FROM conversation_records, json_tree(CASE WHEN json_valid(data) THEN data ELSE '{}' END) AS value WHERE value.type = 'text' AND value.key IN ('taskId', 'task_id', 'inputId') AND value.value = ?",
        )
        .all(key))
        owners.add(String(record.conversation_id));
    }
    if (namespace === "agent_input_preparation") {
      for (const inputRow of this.db
        .prepare(
          "SELECT * FROM domain_documents WHERE namespace = 'agent_inputs'",
        )
        .iterate()) {
        try {
          const data = decode(inputRow.data);
          for (const input of data.inputs ?? [])
            if (input.id === key && typeof input.conversationId === "string")
              owners.add(input.conversationId);
        } catch {
          /* The input owner is independently attributed. */
        }
      }
    }
    return [...owners];
  }
  *records(
    conversationId: string,
    kind?: string,
    recover?: (row: LegacyRow, error: unknown) => Legacy,
  ): Generator<{ row: LegacyRow; data: Legacy }> {
    const statement = kind
      ? this.db.prepare(
          "SELECT * FROM conversation_records WHERE conversation_id = ? AND kind = ? ORDER BY sequence",
        )
      : this.db.prepare(
          "SELECT * FROM conversation_records WHERE conversation_id = ? ORDER BY sequence",
        );
    for (const row of kind
      ? statement.iterate(conversationId, kind)
      : statement.iterate(conversationId)) {
      let data: Legacy;
      try {
        data = decode(row.data);
      } catch (error) {
        if (!recover) throw error;
        data = recover(row, error);
      }
      yield { row, data };
    }
  }
  /**
   * Conversation documents, decoded per row so one corrupt document cannot
   * stop the walk. `id` is the stable source key used for discard decisions;
   * `data` is absent exactly when the document could not be read.
   */
  *conversations(): Generator<{ id: string; data?: Legacy; error?: unknown }> {
    for (const row of this.db
      .prepare(
        "SELECT document_id, data FROM domain_documents WHERE namespace = 'conversation'",
      )
      .iterate()) {
      let data: Legacy;
      try {
        data = decode(row.data);
        if (!data || typeof data !== "object" || typeof data.id !== "string")
          throw new Error("Conversation document has no ID");
      } catch (error) {
        yield { id: String(row.document_id), error };
        continue;
      }
      yield { id: data.id, data };
    }
  }
  record(id: string): Legacy | null {
    const row = this.db
      .prepare("SELECT data FROM conversation_records WHERE id = ?")
      .get(id);
    return row ? decode(row.data) : null;
  }
  hasTable(name: string): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
  }
  close(): void {
    this.db.close();
  }
}

export class ImportReport {
  readonly selectedPaths: SelectedPathVerification = {
    roots: 0,
    children: 0,
    userMessageMismatches: [],
    headMismatches: [],
    unansweredToolCalls: 0,
    duplicateToolResults: 0,
    orphanToolResults: 0,
  };
  readonly skipped = new Map<string, number>();
  readonly losses = new Map<string, number>();
  readonly paths: {
    conversationId: string;
    oldLeafId: string | null;
    mappedLeafId: string | null;
    isRoot: boolean;
    label: string;
    oldUserDigests: string[];
  }[] = [];
  readonly salvagedRecords: Array<{
    conversationId: string;
    sourceRecordId: string;
    eventId: string;
    textDigest: string;
  }> = [];
  readonly sourceFiles: Array<{ conversationId: string; logicalPath: string }> =
    [];
  readonly missingAssetIds: string[] = [];
  readonly relocatedPayloads: Record<string, string> = {};
  diskFiles = 0;
  trackedFiles = 0;
  missingFiles = 0;
  skip(reason: string, count = 1): void {
    if (count)
      this.skipped.set(reason, (this.skipped.get(reason) ?? 0) + count);
  }
  loss(reason: string): void {
    this.losses.set(reason, (this.losses.get(reason) ?? 0) + 1);
  }
  /** Returns a function that drops everything recorded after this call. */
  checkpoint(): () => void {
    const selected = structuredClone(this.selectedPaths);
    const skipped = new Map(this.skipped);
    const losses = new Map(this.losses);
    const paths = this.paths.length;
    const missing = this.missingAssetIds.length;
    const sourceFiles = this.sourceFiles.length;
    const salvaged = this.salvagedRecords.length;
    // Payloads are only ever added, so later keys are exactly the new ones.
    const relocated = Object.keys(this.relocatedPayloads).length;
    const { diskFiles, trackedFiles, missingFiles } = this;
    return () => {
      Object.assign(this.selectedPaths, selected);
      for (const [map, saved] of [
        [this.skipped, skipped],
        [this.losses, losses],
      ] as const) {
        map.clear();
        for (const [key, value] of saved) map.set(key, value);
      }
      this.paths.length = paths;
      this.missingAssetIds.length = missing;
      this.sourceFiles.length = sourceFiles;
      this.salvagedRecords.length = salvaged;
      for (const key of Object.keys(this.relocatedPayloads).slice(relocated))
        delete this.relocatedPayloads[key];
      Object.assign(this, { diskFiles, trackedFiles, missingFiles });
    };
  }
}
