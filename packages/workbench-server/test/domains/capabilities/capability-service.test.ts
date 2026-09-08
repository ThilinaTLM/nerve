import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defaultSettings } from "@nervekit/contracts/settings";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import { CapabilityService } from "../../../src/domains/capabilities/capability.service.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nerve-capabilities-"));
  const project: ProjectRecord = {
    id: "proj_test",
    name: "Test",
    dir: join(root, "project"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await mkdir(project.dir, { recursive: true });
  const records = new Map<string, { data: unknown; revision: number }>();
  const canonicalStore = {
    readDocument: async (_namespace: string, _scope: string, id: string) =>
      records.get(id),
    writeDocument: async (input: {
      documentId: string;
      data: unknown;
      expectedRevision: number;
    }) => {
      const revision = (records.get(input.documentId)?.revision ?? 0) + 1;
      records.set(input.documentId, { data: input.data, revision });
      return { revision };
    },
    deleteDocument: async (_namespace: string, _scope: string, id: string) => {
      records.delete(id);
    },
  };
  const storage = {
    paths: { conversationsPath: join(root, "conversations") },
    settings: {
      ...defaultSettings,
      tools: { ...defaultSettings.tools, disabled: ["python_exec"] },
      skills: {
        disabled: ["release"],
        agentBrowser: { enabled: ["core"] },
      },
    },
    canonicalStore,
  };
  const conversation = { id: "conv_test", projectId: project.id };
  const service = new CapabilityService(
    storage as never,
    () => project,
    () => conversation as never,
  );
  return { root, project, service };
}

test("untrusted project overrides are visible but inactive until trusted", async () => {
  const { project, service } = await fixture();
  const path = join(project.dir, ".nerve", "config", "capabilities.json");
  await mkdir(join(project.dir, ".nerve", "config"), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      tools: { python_exec: true },
      skills: { file: { release: true }, agentBrowser: { core: false } },
    }),
  );

  const untrusted = await service.configuration(project.id);
  assert.equal(untrusted.trust.status, "untrusted");
  assert.deepEqual(untrusted.effective.disabledTools, [
    "python_exec",
    "jira",
    "confluence",
  ]);

  await service.updateTrust(project.id, true, untrusted.projectDigest);
  const trusted = await service.configuration(project.id);
  assert.equal(trusted.trust.status, "trusted");
  assert.deepEqual(trusted.effective.disabledTools, ["jira", "confluence"]);
  assert.deepEqual(trusted.effective.disabledFileSkills, []);
  assert.deepEqual(trusted.effective.enabledAgentBrowserSkills, []);
});

test("configurations omit undefined fields so RPC results can be persisted", async () => {
  const { project, service } = await fixture();

  const withoutConversation = await service.configuration(project.id);
  assert.deepEqual(
    Object.entries(withoutConversation).filter(
      ([, value]) => value === undefined,
    ),
    [],
  );
  assert.ok(!("conversation" in withoutConversation));
  assert.ok(!("conversationDigest" in withoutConversation));

  const withConversation = await service.configuration(project.id, "conv_test");
  assert.equal(withConversation.conversationDigest, "missing");
  assert.ok(!("conversation" in withConversation));
});

test("conversation overrides win and stale writes are rejected", async () => {
  const { project, service } = await fixture();
  let configuration = await service.configuration(project.id, "conv_test");
  configuration = await service.update({
    projectId: project.id,
    conversationId: "conv_test",
    origin: "conversation",
    patch: { tools: { python_exec: true } },
    expectedDigest: configuration.conversationDigest,
  });
  assert.deepEqual(configuration.effective.disabledTools, [
    "jira",
    "confluence",
  ]);

  await assert.rejects(
    service.update({
      projectId: project.id,
      conversationId: "conv_test",
      origin: "conversation",
      patch: { tools: { explore: false } },
      expectedDigest: "missing",
    }),
    /changed since it was loaded/,
  );
});
