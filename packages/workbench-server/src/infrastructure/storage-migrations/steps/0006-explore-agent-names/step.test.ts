import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import step from "./step.js";

void test("0006-explore-agent-names", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE domain_documents (namespace TEXT, scope_id TEXT, document_id TEXT, revision INTEGER, data BLOB); CREATE TABLE conversation_records (kind TEXT, conversation_id TEXT, sequence INTEGER, data BLOB);",
  );
  db.prepare(
    "INSERT INTO domain_documents VALUES ('agent','global','child',1,?)",
  ).run(
    new TextEncoder().encode(
      JSON.stringify({
        conversationId: "conv_1",
        parentAgentId: "parent",
        task: "inspect",
      }),
    ),
  );
  db.prepare(
    "INSERT INTO conversation_records VALUES ('tool_call','conv_1',1,?)",
  ).run(
    new TextEncoder().encode(
      JSON.stringify({
        toolName: "explore",
        agentId: "parent",
        args: { tasks: ["hostile", { task: "inspect", label: " Storage " }] },
      }),
    ),
  );
  await step.run({ db } as never);
  const data = (
    db.prepare("SELECT data FROM domain_documents").get() as {
      data: Uint8Array;
    }
  ).data;
  assert.equal(JSON.parse(new TextDecoder().decode(data)).name, "Storage");
  db.close();
});
