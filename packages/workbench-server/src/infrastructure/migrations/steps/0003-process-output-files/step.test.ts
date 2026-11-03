import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openCoreStorage } from "@nervekit/conversation-core";
import { createStepContext } from "../../framework/context.js";
import { RollbackJournal } from "../../framework/rollback-journal.js";
import { storagePaths } from "../../../storage-bootstrap/paths.js";
import step from "./step.js";

const now = "2026-10-10T00:00:00.000Z";

function home() {
  const root = mkdtempSync(join(tmpdir(), "nerve-0003-"));
  const paths = storagePaths(root);
  mkdirSync(paths.dataPath, { recursive: true });
  const storage = openCoreStorage(paths.sqlitePath);
  storage.projects.insert({
    id: "proj_1",
    name: "Test",
    directory: root,
    createdAt: now,
    updatedAt: now,
  });
  storage.conversations.insert(
    {
      id: "conv_1",
      projectId: "proj_1",
      parentConversationId: null,
      parentToolCallId: null,
      headEventId: null,
      title: "Test",
      status: "idle",
      statusEventSequence: 0,
      statusClearedAt: null,
      paused: false,
      nextInputSequence: 1,
      pinnedAt: null,
      completedAt: null,
      lastUserMessageAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      conversationId: "conv_1",
      model: { provider: "test", modelId: "test" },
      reasoningLevel: "off",
      systemPrompt: null,
      instructions: null,
      permissionRuleSetId: "baseline",
      agentProfile: "coding",
      workingDirectory: root,
    },
  );
  const run = (id: string, files: Record<string, string>) => {
    storage.asyncBash.insert({
      id,
      conversationId: "conv_1",
      toolCallId: `tool_${id}`,
      command: "echo",
      workingDirectory: root,
      processRef: null,
      status: "completed",
      exitCode: 0,
      startedAt: now,
      finishedAt: now,
    });
    for (const [name, text] of Object.entries(files)) {
      const logicalPath = `conversations/conv_1/async-bash/${id}/${name}`;
      mkdirSync(join(paths.dataPath, `conversations/conv_1/async-bash/${id}`), {
        recursive: true,
      });
      writeFileSync(join(paths.dataPath, logicalPath), text);
      storage.assets.insert({
        id: `asset_${id}_${name}`,
        conversationId: "conv_1",
        eventId: null,
        toolCallId: `tool_${id}`,
        asyncBashId: id,
        category: "bash_output",
        logicalPath,
        digest: null,
        byteLength: Buffer.byteLength(text),
        mediaType: null,
        createdAt: now,
      });
    }
  };
  run("bash_combined", {
    "stdout.txt": "out\n",
    "stderr.txt": "err\n",
    "combined.txt": "[stdout]\nout\n[stderr]\nerr\n",
  });
  run("bash_streams", { "stdout.txt": "out\n", "stderr.txt": "err\n" });
  run("bash_current", { "output.txt": "already\n" });
  storage.close();
  const { context } = createStepContext(
    paths,
    step.id,
    step.description,
    () => {},
  );
  const outputs = () => {
    const db = openCoreStorage(paths.sqlitePath);
    try {
      return db.assets
        .list("conv_1")
        .filter((asset) => asset.logicalPath.endsWith("/output.txt"))
        .map((asset) => asset.logicalPath)
        .sort();
    } finally {
      db.close();
    }
  };
  return { root, paths, context, outputs };
}

void test("creates one output file per older background run and is idempotent", async (t) => {
  const { root, paths, context, outputs } = home();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const owned = await step.ownedPaths!(context);
  assert.equal(owned.length, 2);
  await step.run(context);
  await step.verify!(context);
  const file = (id: string) =>
    readFileSync(
      join(paths.dataPath, `conversations/conv_1/async-bash/${id}/output.txt`),
      "utf8",
    );
  // Ordered, labelled output is preferred; otherwise both streams in sequence.
  assert.equal(file("bash_combined"), "[stdout]\nout\n[stderr]\nerr\n");
  assert.equal(file("bash_streams"), "out\nerr\n");
  assert.equal(file("bash_current"), "already\n");
  assert.equal(outputs().length, 3);
  // Original stream files stay: older transcripts quote their paths.
  readFileSync(
    join(
      paths.dataPath,
      "conversations/conv_1/async-bash/bash_streams/stdout.txt",
    ),
  );
  await step.run(context);
  assert.equal(outputs().length, 3);
});

void test("rollback removes inserted rows and created files", async (t) => {
  const { root, paths, context, outputs } = home();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await step.run(context);
  await step.run(context); // a retried attempt keeps the first attempt's rollback record
  await step.rollback!(context);
  new RollbackJournal(context.scratchDir).restore();
  assert.deepEqual(outputs(), [
    "conversations/conv_1/async-bash/bash_current/output.txt",
  ]);
  assert.throws(() =>
    readFileSync(
      join(
        paths.dataPath,
        "conversations/conv_1/async-bash/bash_streams/output.txt",
      ),
    ),
  );
});
