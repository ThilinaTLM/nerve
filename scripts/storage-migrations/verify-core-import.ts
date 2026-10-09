import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  LegacyReader,
  iso,
  type Legacy,
} from "../../packages/workbench-server/src/infrastructure/core-import/legacy.reader.js";
import { userMessageDigest } from "../../packages/workbench-server/src/infrastructure/core-import/selected-path.validation.js";

const { values } = parseArgs({
  options: { home: { type: "string" } },
  allowPositionals: false,
});
if (!values.home)
  throw new Error(
    "Usage: pnpm exec tsx scripts/storage-migrations/verify-core-import.ts --home <COPIED_HOME>",
  );
const home = resolve(values.home);
const source = new LegacyReader(join(home, "data", "nerve.sqlite"));
const core = new DatabaseSync(join(home, "data", "core.sqlite"), {
  readOnly: true,
});
const sourceLeaves = source.db.prepare(
  "SELECT active_record_id FROM agent_context_leaves WHERE conversation_id = ? AND agent_id = ?",
);
const coreEvent = core.prepare(
  "SELECT previous_event_id, event_type, payload FROM conversation_event WHERE id = ?",
);
const rootMismatches: string[] = [];
const childMismatches: string[] = [];
const unmappedChildren: string[] = [];
let roots = 0;
let children = 0;
let unanswered = 0;
let duplicates = 0;
let orphans = 0;

function oldUsers(leaf: string | null): string[] {
  const users: string[] = [];
  while (leaf) {
    const record = source.record(leaf);
    if (!record) throw new Error(`Missing old record ${leaf}`);
    const entry = record.modelContext?.entry;
    if (entry?.message?.role === "user")
      users.push(userMessageDigest(entry.message));
    // A history-only leaf (e.g. run_status) uses its transcript predecessor.
    // Never replace an explicit null on a Pi entry with that fallback.
    leaf =
      entry && "parentId" in entry
        ? entry.parentId
        : (record.entry?.parentEntryId ?? null);
  }
  return users;
}

function newPath(leaf: string | null): string[] {
  const users: string[] = [];
  const calls = new Map<string, number>();
  const results = new Map<string, number>();
  while (leaf) {
    const row = coreEvent.get(leaf);
    if (!row) throw new Error(`Missing core event ${leaf}`);
    const payload = JSON.parse(String(row.payload));
    if (row.event_type === "user_message")
      users.push(userMessageDigest({ content: payload.text }));
    if (row.event_type === "assistant_message")
      for (const block of payload.content) {
        if (block.type === "toolCall")
          calls.set(block.id, (calls.get(block.id) ?? 0) + 1);
      }
    if (row.event_type === "tool_call_response" && payload.origin === "model")
      results.set(
        payload.providerCallId,
        (results.get(payload.providerCallId) ?? 0) + 1,
      );
    leaf =
      row.previous_event_id === null ? null : String(row.previous_event_id);
  }
  for (const [id, count] of calls)
    unanswered += Math.max(0, count - (results.get(id) ?? 0));
  for (const [id, count] of results) {
    duplicates += Math.max(0, count - 1);
    orphans += Math.max(0, count - (calls.get(id) ?? 0));
  }
  return users;
}

try {
  const paths = new Map<string, string[]>();
  for (const row of core
    .prepare("SELECT id, head_event_id FROM conversation")
    .iterate())
    paths.set(
      String(row.id),
      newPath(row.head_event_id === null ? null : String(row.head_event_id)),
    );
  const agents: Legacy[] = [];
  for (const { data } of source.documents("agent")) agents.push(data);
  const agentConversations = new Map<string, string>();
  for (const agent of agents)
    if (!agent.parentAgentId)
      agentConversations.set(agent.id, agent.conversationId);
  for (const { data } of source.documents("conversation")) {
    const leaf = sourceLeaves.get(data.id, "agent_conversation");
    const expected = oldUsers(
      leaf
        ? leaf.active_record_id === null
          ? null
          : String(leaf.active_record_id)
        : (data.activeEntryId ?? null),
    );
    const actual = paths.get(data.id);
    roots++;
    if (
      !actual ||
      expected.length !== actual.length ||
      expected.some((digest, index) => digest !== actual[index])
    )
      rootMismatches.push(data.id);
  }
  const pending = agents.filter((agent) => agent.parentAgentId);
  while (pending.length) {
    const index = pending.findIndex((agent) =>
      agentConversations.has(agent.parentAgentId),
    );
    if (index < 0) {
      unmappedChildren.push(...pending.map((agent) => agent.id));
      break;
    }
    const agent = pending.splice(index, 1)[0]!;
    const candidates = core
      .prepare(
        "SELECT id FROM conversation WHERE parent_conversation_id = ? AND created_at = ? AND title = ?",
      )
      .all(
        agentConversations.get(agent.parentAgentId)!,
        iso(agent.createdAt),
        agent.name ?? agent.task?.slice(0, 100) ?? "Child conversation",
      );
    if (candidates.length !== 1) {
      unmappedChildren.push(agent.id);
      continue;
    }
    const id = String(candidates[0]!.id);
    agentConversations.set(agent.id, id);
    const leaf = sourceLeaves.get(agent.conversationId, agent.id);
    const fallback = source.db
      .prepare(
        "SELECT id FROM conversation_records WHERE conversation_id = ? AND agent_id = ? AND kind IN ('message', 'summary') ORDER BY sequence DESC LIMIT 1",
      )
      .get(agent.conversationId, agent.id);
    const expected = oldUsers(
      leaf
        ? leaf.active_record_id === null
          ? null
          : String(leaf.active_record_id)
        : fallback
          ? String(fallback.id)
          : null,
    );
    const actual = paths.get(id)!;
    children++;
    if (
      expected.length !== actual.length ||
      expected.some((digest, offset) => digest !== actual[offset])
    )
      childMismatches.push(agent.id);
  }
  console.log(
    JSON.stringify(
      {
        roots,
        children,
        rootMismatches,
        childMismatches,
        unmappedChildren,
        selectedPaths: paths.size,
        unanswered,
        duplicates,
        orphans,
        foreignKeyFailures: core.prepare("PRAGMA foreign_key_check").all()
          .length,
        integrity: core.prepare("PRAGMA quick_check").get(),
      },
      null,
      2,
    ),
  );
  if (
    rootMismatches.length ||
    childMismatches.length ||
    unmappedChildren.length ||
    unanswered ||
    duplicates ||
    orphans
  )
    process.exitCode = 1;
} finally {
  core.close();
  source.close();
}
