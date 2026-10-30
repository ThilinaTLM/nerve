import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import type {
  ImportReport,
  Legacy,
  LegacyReader,
  LegacyRow,
} from "./legacy.reader.js";

/** No role/content reconstruction: only an explicitly unknown, visible history gap. */
export class MessageSalvage {
  #active = false;
  #unsafe = false;
  #checked = false;
  readonly #placeholders = new WeakSet<Legacy>();
  constructor(
    private readonly reader: LegacyReader,
    private readonly report: ImportReport,
    private readonly conversation: Legacy,
    private readonly agents: readonly Legacy[],
    private readonly hasPendingWork: boolean,
  ) {}

  /** Readable neighbors must corroborate the relational chain and contain no tool semantics. */
  observe(row: LegacyRow, data: Legacy): void {
    if (this.#placeholders.has(data)) return;
    const context = data?.modelContext?.entry;
    const message = context?.message;
    const content = message?.content;
    const textOnly =
      typeof content === "string" ||
      (Array.isArray(content) &&
        content.every(
          (block: Legacy) =>
            block?.type === "text" && typeof block.text === "string",
        ));
    this.#unsafe ||=
      row.kind !== "message" ||
      data?.entry?.kind !== "message" ||
      context?.type !== "message" ||
      !["user", "assistant"].includes(message?.role) ||
      !textOnly ||
      !("parentId" in context) ||
      context.parentId !== row.parent_id;
    if (this.#active)
      assert(
        !this.#unsafe,
        "Lost message has ambiguous history or non-text/tool-bearing neighbors",
      );
  }

  recover(row: LegacyRow, error: unknown): Legacy {
    // Shape/policy errors are not candidates. Missing roots are never invented.
    assert(
      error instanceof SyntaxError && row.kind === "message",
      "Only unreadable JSON message records can be salvaged",
    );
    assert(
      typeof row.parent_id === "string" && row.parent_id.length > 0,
      "Cannot salvage a message without a surviving predecessor",
    );
    assert(
      !this.#unsafe,
      "Lost message has ambiguous history or non-text/tool-bearing neighbors",
    );
    this.checkChain();
    const ctx = this.reader.context;
    assert(ctx, "Message salvage requires the migration toolkit");
    const reason = `Unreadable message record ${row.id} in ${row.conversation_id}, sequence ${row.sequence}: ${error.message.split("\n")[0].slice(0, 240)}`;
    const path = ctx.quarantine(
      {
        kind: "conversation",
        id: `${row.conversation_id}/record/${row.id}`,
        title:
          typeof this.conversation.title === "string"
            ? this.conversation.title
            : undefined,
        reason,
      },
      { records: [{ table: "conversation_records", row }], setAside: false },
    );
    this.report.loss(
      "Unreadable message record; a visible history placeholder was inserted; original bytes preserved in quarantine",
    );
    this.#active = true;
    const data: Legacy = {
      entry: {
        id: row.id,
        kind: "migration_loss",
        parentEntryId: row.parent_id,
        text: `History unavailable: legacy message ${row.id} (sequence ${row.sequence}) was unreadable during upgrade. Its speaker and content are unknown; readable history was retained. Original record: ${path}`,
      },
      modelContext: {
        visibility: "history_only",
        entry: { id: row.id, type: "migration_loss", parentId: row.parent_id },
      },
    };
    this.#placeholders.add(data);
    return data;
  }

  recordEvent(data: Legacy, event: Legacy): void {
    if (!this.#placeholders.has(data)) return;
    this.report.salvagedRecords.push({
      conversationId: event.conversationId,
      sourceRecordId: data.entry.id,
      eventId: event.id,
      textDigest: createHash("sha256").update(event.payload.text).digest("hex"),
    });
  }

  private checkChain(): void {
    if (this.#checked) return;
    assert(
      !this.hasPendingWork &&
        this.agents.length === 1 &&
        !this.agents[0].parentAgentId &&
        this.conversation.activeAgentId === this.agents[0].id &&
        !!this.agents[0].model,
      "Message salvage requires one explicit root agent and no queued inputs or tasks",
    );
    let previous: string | null = null;
    let sequence = 0;
    for (const row of this.reader.db
      .prepare(
        "SELECT id, conversation_id, agent_id, parent_id, run_id, kind, sequence, created_at_ms FROM conversation_records WHERE conversation_id = ? ORDER BY sequence",
      )
      .iterate(this.conversation.id)) {
      assert(
        typeof row.id === "string" &&
          row.id.length > 0 &&
          row.id.length <= 256 &&
          row.conversation_id === this.conversation.id &&
          row.agent_id === this.agents[0].id &&
          row.kind === "message" &&
          row.run_id === null &&
          typeof row.sequence === "number" &&
          Number.isSafeInteger(row.sequence) &&
          row.sequence > sequence &&
          typeof row.created_at_ms === "number" &&
          Number.isSafeInteger(row.created_at_ms) &&
          Number.isFinite(new Date(row.created_at_ms).getTime()) &&
          row.parent_id === previous,
        "Message salvage requires an intact, unique, single-agent linear relational chain",
      );
      previous = row.id;
      sequence = row.sequence;
    }
    assert(previous, "Message salvage requires a nonempty chain");
    const leaves = this.reader.db
      .prepare(
        "SELECT agent_id, active_record_id FROM agent_context_leaves WHERE conversation_id = ?",
      )
      .all(this.conversation.id);
    assert(
      leaves.length > 0 &&
        leaves.every(
          (leaf) =>
            [this.agents[0].id, "agent_conversation"].includes(
              String(leaf.agent_id),
            ) && leaf.active_record_id === previous,
        ),
      "Message salvage requires an unambiguous selected terminal head",
    );
    assert(
      !this.reader.db
        .prepare(
          "SELECT 1 FROM file_assets WHERE conversation_id = ? AND tool_call_id IS NOT NULL LIMIT 1",
        )
        .get(this.conversation.id),
      "Tool-bearing history cannot be salvaged as plain messages",
    );
    this.#checked = true;
  }
}
