import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { StepContext } from "../../framework/step.js";
import { decode, LegacyReader, type LegacyRow } from "./legacy.reader.js";

/** Export only excluded owners' rows; never copy the shared database. */
export function quarantineDiscardedConversations(ctx: StepContext): void {
  const source = `${ctx.paths.sqlitePath}.migrating`;
  if (!existsSync(source)) return;
  const reader = new LegacyReader(source);
  try {
    for (const id of ctx.discarded) {
      if (isAbsolute(id) || id.startsWith("legacy-record:")) continue;
      const records: Array<{ table: string; row: LegacyRow }> = [];
      const files: string[] = [];
      const add = (path: string) => {
        if (existsSync(path)) files.push(path);
      };
      if (/^conv_[A-Za-z0-9_-]+$/.test(id)) {
        add(join(ctx.paths.dataPath, "conversations", id.slice(5)));
        add(join(ctx.paths.dataPath, "reports", "conversations", id));
      }
      const agents = new Set(
        reader.db
          .prepare(
            "SELECT DISTINCT agent_id FROM conversation_records WHERE conversation_id = ? UNION SELECT DISTINCT agent_id FROM agent_context_leaves WHERE conversation_id = ?",
          )
          .all(id, id)
          .map((row) => String(row.agent_id)),
      );
      const inputIds = new Set<string>();
      for (const inputRow of reader.db
        .prepare(
          "SELECT data FROM domain_documents WHERE namespace = 'agent_inputs'",
        )
        .iterate()) {
        try {
          for (const input of decode(inputRow.data).inputs ?? [])
            if (input.conversationId === id && typeof input.id === "string")
              inputIds.add(input.id);
        } catch {
          /* Damaged input documents are attributed by relational ownership. */
        }
      }
      for (const row of reader.db
        .prepare(
          "SELECT * FROM domain_documents WHERE namespace IN ('conversation', 'agent', 'task', 'agent_inputs', 'agent_input_preparation')",
        )
        .iterate()) {
        let owned = row.namespace === "conversation" && row.document_id === id;
        owned ||=
          ["agent", "agent_inputs"].includes(String(row.namespace)) &&
          agents.has(String(row.document_id));
        owned ||=
          row.namespace === "agent_input_preparation" &&
          inputIds.has(String(row.document_id));
        try {
          const data = decode(row.data);
          owned ||=
            data.conversationId === id ||
            (Array.isArray(data.inputs) &&
              data.inputs.some(
                (input: { conversationId?: string }) =>
                  input.conversationId === id,
              ));
          if (
            owned &&
            row.namespace === "task" &&
            /^task_[A-Za-z0-9_-]+$/.test(String(row.document_id))
          )
            add(join(ctx.paths.dataPath, "tasks", String(row.document_id)));
        } catch {
          owned ||= reader
            .recordOwners(String(row.namespace), row)
            .includes(id);
        }
        if (owned) records.push({ table: "domain_documents", row });
      }
      ctx.quarantine(
        {
          kind: "conversation",
          id,
          reason: "Conversation set aside after an upgrade failure",
        },
        {
          records: (function* () {
            for (const table of [
              "conversation_records",
              "agent_context_leaves",
              "file_assets",
            ]) {
              for (const row of reader.db
                .prepare(`SELECT * FROM ${table} WHERE conversation_id = ?`)
                .iterate(id))
                yield { table, row };
            }
            yield* records;
          })(),
          files,
        },
      );
    }
  } finally {
    reader.close();
  }
}
