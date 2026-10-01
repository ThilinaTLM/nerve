import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defaultSettings } from "@nervekit/contracts/settings";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import { CapabilityService } from "../../../src/domains/capabilities/capability.service.js";

async function fixture(
  providers: typeof defaultSettings.providers = defaultSettings.providers,
) {
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
      providers,
      tools: { ...defaultSettings.tools, disabled: ["python_exec"] },
      skills: {
        disabled: ["release"],
        nerve: { enabled: ["skill-creator"] },
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
      skills: {
        file: { release: true },
        nerve: { "skill-creator": false },
        agentBrowser: { core: false },
      },
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
  assert.deepEqual(trusted.effective.enabledNerveSkills, []);
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
    patch: { tools: { python_exec: { enabled: true } } },
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
      patch: { tools: { explore: { enabled: false } } },
      expectedDigest: "missing",
    }),
    /changed since it was loaded/,
  );
});

const atlassianProviders = {
  atlassianProfiles: [
    {
      id: "ner",
      name: "NER",
      siteUrl: "https://ner.atlassian.net",
      email: "dev@example.com",
    },
    { id: "pplied", name: "Pplied" },
  ],
  tavilyProfiles: [{ id: "search", name: "Search" }],
};

test("integrations are offered once a profile exists and expose profile options", async () => {
  const empty = await fixture();
  assert.ok(
    !(
      await empty.service.configuration(empty.project.id)
    ).availableTools.includes("jira"),
  );

  const { project, service } = await fixture(atlassianProviders);
  const configuration = await service.configuration(project.id);
  assert.ok(configuration.availableTools.includes("jira"));
  assert.ok(configuration.availableTools.includes("confluence"));
  assert.deepEqual(configuration.toolProfileOptions.jira, [
    { id: "ner", name: "NER", detail: "https://ner.atlassian.net" },
    { id: "pplied", name: "Pplied" },
  ]);
  assert.deepEqual(configuration.toolProfileOptions.web_search, [
    { id: "search", name: "Search" },
  ]);
});

test("conversation integration overrides drive execution settings and prune inherited values", async () => {
  const { project, service } = await fixture(atlassianProviders);
  let configuration = await service.configuration(project.id, "conv_test");
  assert.equal(configuration.inherited.disabledTools.includes("jira"), true);

  configuration = await service.update({
    projectId: project.id,
    conversationId: "conv_test",
    origin: "conversation",
    patch: { tools: { jira: { enabled: true, profileId: "pplied" } } },
  });
  assert.deepEqual(configuration.conversation?.tools, {
    jira: { enabled: true, profileId: "pplied" },
  });
  const { integrations } = await service.toolScope(project.id, "conv_test");
  assert.equal(integrations.jira.enabled, true);
  assert.equal(integrations.jira.profile?.id, "pplied");
  assert.equal(integrations.confluence.enabled, false);

  configuration = await service.update({
    projectId: project.id,
    conversationId: "conv_test",
    origin: "conversation",
    patch: { tools: { jira: { enabled: false } } },
  });
  assert.deepEqual(configuration.conversation?.tools, {
    jira: { profileId: "pplied" },
  });
});

test("conversation inheritance includes only a trusted project", async () => {
  const { project, service } = await fixture(atlassianProviders);
  await service.update({
    projectId: project.id,
    origin: "project",
    patch: { tools: { jira: { enabled: true, profileId: "ner" } } },
  });
  const trusted = await service.configuration(project.id, "conv_test");
  assert.equal(trusted.inherited.disabledTools.includes("jira"), false);
  assert.equal(trusted.inherited.toolProfiles.jira, "ner");

  await service.updateTrust(project.id, false);
  const untrusted = await service.configuration(project.id, "conv_test");
  assert.equal(untrusted.inherited.disabledTools.includes("jira"), true);
  assert.equal(untrusted.inherited.toolProfiles.jira, undefined);
});

test("conversation tool settings apply to execution settings only in that conversation", async () => {
  const { project, service } = await fixture();
  const model = { provider: "openai", modelId: "gpt-5.1-mini" };
  const configuration = await service.update({
    projectId: project.id,
    conversationId: "conv_test",
    origin: "conversation",
    patch: {
      toolSettings: {
        explore: { model, thinkingLevel: "high" },
        kroki_export: { url: "http://127.0.0.1:9080/kroki" },
      },
    },
  });
  assert.deepEqual(configuration.conversation?.toolSettings, {
    explore: { model, thinkingLevel: "high" },
    kroki_export: { url: "http://127.0.0.1:9080/kroki/" },
  });

  const conversationSettings = await service.settings(project.id, "conv_test");
  assert.deepEqual(conversationSettings.exploreAgent, {
    model,
    thinkingLevel: "high",
  });
  assert.equal(
    conversationSettings.tools.kroki.url,
    "http://127.0.0.1:9080/kroki/",
  );
  const scope = await service.toolScope(project.id, "conv_test");
  assert.equal(
    scope.toolSettings.kroki_export.url,
    "http://127.0.0.1:9080/kroki/",
  );

  const projectSettings = await service.settings(project.id);
  assert.deepEqual(projectSettings.exploreAgent, defaultSettings.exploreAgent);
  assert.equal(
    projectSettings.tools.kroki.url,
    defaultSettings.tools.kroki.url,
  );
});
