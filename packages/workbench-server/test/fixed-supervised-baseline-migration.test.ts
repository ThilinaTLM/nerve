import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import type { MigrationContext } from "../src/infrastructure/migrations/migration.js";
import { migration0014 } from "../src/infrastructure/migrations/migrations/0014-fixed-supervised-baseline.js";

const roots: string[] = [];
after(async () =>
  Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))),
);

it("removes configurable read approval from authoritative agent and conversation records", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "nerve-fixed-supervised-baseline-"),
  );
  roots.push(root);
  const agentPath = join(root, "agents", "agent_legacy", "agent.json");
  const conversationPath = join(
    root,
    "conversations",
    "conv_legacy",
    "conversation.json",
  );
  await mkdir(join(root, "agents", "agent_legacy"), { recursive: true });
  await mkdir(join(root, "conversations", "conv_legacy"), { recursive: true });
  await mkdir(join(root, "migrations"), { recursive: true });
  const timestamp = "2026-08-18T01:02:03.000Z";
  await writeFile(
    agentPath,
    `${JSON.stringify({
      id: "agent_legacy",
      conversationId: "conv_legacy",
      projectId: "proj_legacy",
      projectDir: "/tmp/project",
      rootAgentId: "agent_legacy",
      mode: "coding",
      permissionLevel: "supervised",
      approvalPolicy: { autoApproveReadOnly: false },
      workspaceScope: { roots: ["/tmp/project"] },
      status: "idle",
      createdAt: timestamp,
      updatedAt: timestamp,
    })}\n`,
  );
  await writeFile(
    conversationPath,
    `${JSON.stringify({
      id: "conv_legacy",
      projectId: "proj_legacy",
      title: "Legacy",
      mode: "coding",
      permissionLevel: "supervised",
      approvalPolicy: { autoApproveReadOnly: false },
      createdAt: timestamp,
      updatedAt: timestamp,
    })}\n`,
  );

  const context = {
    paths: { home: root },
    now: () => new Date("2026-08-23T00:00:00.000Z"),
  } as unknown as MigrationContext;
  const backup = await migration0014.backup(context);
  assert.deepEqual(backup.paths, [
    "agents/agent_legacy/agent.json",
    "conversations/conv_legacy/conversation.json",
    "migrations/.fixed-supervised-baseline-v1",
  ]);

  await migration0014.up(context);
  await migration0014.verify(context);
  const agent = JSON.parse(await readFile(agentPath, "utf8")) as Record<
    string,
    unknown
  >;
  const conversation = JSON.parse(
    await readFile(conversationPath, "utf8"),
  ) as Record<string, unknown>;
  assert.equal("approvalPolicy" in agent, false);
  assert.equal("approvalPolicy" in conversation, false);
  assert.equal(await migration0014.detect(context), "current");
});
