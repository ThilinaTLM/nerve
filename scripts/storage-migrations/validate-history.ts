import { DatabaseSync } from "node:sqlite";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  conversationEventSchema,
  toolCallSchema,
} from "../../packages/contracts/src/domains/core/index.js";

/** Offline release gate: validate persisted rows, not just the selected history branch.
 * Intentionally uses CURRENT contracts, unlike frozen migration conversions. */
export function validateHistory(home: string) {
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"), {
    readOnly: true,
  });
  const classes = new Map<string, { rows: number; examples: string[] }>();
  let events = 0,
    calls = 0,
    failedEvents = 0,
    failedCalls = 0;
  const record = (
    table: string,
    id: string,
    issues: readonly {
      path: readonly PropertyKey[];
      code: string;
      message: string;
    }[],
  ) => {
    const keys = new Set(
      issues.map(
        (issue) =>
          `${table}: ${issue.path.join(".")} (${issue.code}: ${issue.message})`,
      ),
    );
    for (const key of keys) {
      const entry = classes.get(key) ?? { rows: 0, examples: [] };
      entry.rows++;
      if (entry.examples.length < 3) entry.examples.push(id);
      classes.set(key, entry);
    }
  };
  try {
    db.exec("BEGIN");
    for (const row of db
      .prepare(
        "SELECT * FROM conversation_event ORDER BY conversation_id, sequence",
      )
      .iterate()) {
      events++;
      try {
        const result = conversationEventSchema.safeParse({
          id: row.id,
          conversationId: row.conversation_id,
          sequence: row.sequence,
          previousEventId: row.previous_event_id,
          type: row.event_type,
          llmRepresentation: row.llm_representation,
          turnId: row.turn_id,
          inputId: row.input_id,
          payload: JSON.parse(String(row.payload)),
          createdAt: row.created_at,
        });
        if (!result.success) {
          failedEvents++;
          record("conversation_event", String(row.id), result.error.issues);
        }
      } catch {
        failedEvents++;
        record("conversation_event", String(row.id), [
          { path: ["payload"], code: "invalid_json", message: "Invalid JSON" },
        ]);
      }
    }
    for (const row of db
      .prepare("SELECT * FROM tool_call ORDER BY id")
      .iterate()) {
      calls++;
      try {
        const result = toolCallSchema.safeParse({
          id: row.id,
          conversationId: row.conversation_id,
          turnId: row.turn_id,
          providerCallId: row.provider_call_id,
          assistantEventId: row.assistant_event_id,
          contentIndex: row.content_index,
          origin: row.origin,
          toolName: row.tool_name,
          arguments: JSON.parse(String(row.arguments)),
          state: row.state,
          supervision:
            row.supervision === null
              ? null
              : JSON.parse(String(row.supervision)),
          interaction:
            row.interaction === null
              ? null
              : JSON.parse(String(row.interaction)),
          executionClaim: row.execution_claim,
          updatedAt: row.updated_at,
        });
        if (!result.success) {
          failedCalls++;
          record("tool_call", String(row.id), result.error.issues);
        }
      } catch {
        failedCalls++;
        record("tool_call", String(row.id), [
          { path: [], code: "invalid_json", message: "Invalid JSON" },
        ]);
      }
    }
    return {
      home,
      events,
      calls,
      failedEvents,
      failedCalls,
      failures: [...classes].map(([reason, value]) => ({ reason, ...value })),
    };
  } finally {
    db.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const { values } = parseArgs({
      options: { home: { type: "string" } },
      allowPositionals: false,
    });
    if (!values.home)
      throw new Error(
        "Usage: pnpm exec tsx scripts/storage-migrations/validate-history.ts --home <stopped-home>",
      );
    const result = validateHistory(resolve(values.home));
    console.log(JSON.stringify(result, null, 2));
    if (result.failedEvents || result.failedCalls) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
