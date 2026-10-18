import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capabilityConfigurationSchema,
  emptyCapabilityOverrides,
} from "@nervekit/contracts/capabilities";
import { defaultSettings } from "@nervekit/contracts/settings";
import {
  builtInSubagentProfiles,
  subagentProfileSchema,
  type SubagentProfilesConfiguration,
} from "@nervekit/contracts/subagents";
import { userCapabilitySelection } from "../../../src/core-host/user-capability-selection.js";
import {
  createCompletionProviders,
  mergeCompletionRemoteSnapshots,
  type CompletionSourcePorts,
} from "../../../src/domains/completions/completion-source-providers.js";
import { candidateFromPath } from "../../../src/domains/completions/file-completion-candidates.js";

function setup() {
  const effective = userCapabilitySelection(defaultSettings);
  effective.disabledTools = ["jira"];
  effective.disabledFileSkills = ["hidden"];
  const config = capabilityConfigurationSchema.parse({
    project: emptyCapabilityOverrides(),
    projectDigest: "project-digest",
    conversation: emptyCapabilityOverrides(),
    conversationDigest: "conversation-digest",
    trust: { status: "missing" },
    inherited: effective,
    effective,
    availableTools: ["jira", "web_search"],
    toolProfileOptions: {
      jira: [{ id: "profile-1", name: "Only site" }],
      confluence: [],
      web_search: [],
    },
  });
  const updates: unknown[] = [];
  let profiles: SubagentProfilesConfiguration = {
    scope: "conversation",
    document: null,
    digest: "profile-digest",
    trust: "trusted",
    diagnostics: [],
    profiles: [],
  };
  const ports: CompletionSourcePorts = {
    project: (id) => ({ id, directory: "/synthetic" }),
    capabilities: {
      configuration: async () => config,
      subscribe: () => () => {},
      update: async (input) => {
        updates.push(input);
        return config;
      },
    },
    profiles: {
      configuration: async () => profiles,
      onChanged: () => () => {},
      update: async (input) => {
        updates.push(input);
        return profiles;
      },
    },
    tools: [{ name: "jira_get_issue", description: "Read a synthetic issue" }],
    skills: async () => [
      {
        name: "hidden",
        description: "Disabled file skill",
        source: "project",
        filePath: "/synthetic/hidden/SKILL.md",
      },
      {
        name: "hidden",
        description: "Shadowed user copy",
        source: "user",
        filePath: "/synthetic/user/hidden/SKILL.md",
      },
    ],
    prs: async () => ({ items: [], refreshing: false, updatedAt: null }),
    issues: async () => ({ items: [], refreshing: false, updatedAt: null }),
    launches: () => [],
    definitions: async () => ({
      projectId: "p",
      revision: "v1",
      folders: [],
      definitions: [],
    }),
    children: () => [],
    discover: async () => [candidateFromPath("src/session.ts", "file")],
  };
  const providers = () => createCompletionProviders(ports);
  const load = async (id: string) => {
    const snapshot = await providers()
      .find((provider) => provider.id === id)!
      .load({ projectId: "p", conversationId: "c" });
    return "documents" in snapshot ? snapshot.documents : snapshot;
  };
  return {
    ports,
    config,
    updates,
    load,
    setProfiles(next: SubagentProfilesConfiguration) {
      profiles = next;
    },
  };
}

void test("project repository caches retain partial freshness and deduplicate shared remote URLs", async () => {
  const f = setup();
  const issue = {
    number: 1,
    title: "Invented session issue",
    url: "https://synthetic.invalid/issue/1",
    state: "OPEN" as const,
    updatedAt: new Date().toISOString(),
    author: null,
  };
  const combined = mergeCompletionRemoteSnapshots([
    {
      items: [{ ...issue, repository: "." }],
      refreshing: false,
      updatedAt: new Date().toISOString(),
    },
    {
      items: [{ ...issue, repository: "nested" }],
      refreshing: true,
      updatedAt: null,
    },
  ]);
  assert.equal(combined.refreshing, true);
  assert.equal(
    combined.stale,
    true,
    "one uncached repository must not be called fresh",
  );
  assert.ok(combined.updatedAt, "retain the healthy repository timestamp");
  f.ports.issues = async () => combined;
  const documents = await f.load("issues");
  assert.equal(
    documents.length,
    1,
    "same remote issue through two repositories has one stable identity",
  );
  assert.match(documents[0]?.item.detail ?? "", /nested/);
});

void test("explicit failed or stale remote caches preserve healthy siblings without claiming fresh", async () => {
  const f = setup();
  const now = new Date().toISOString();
  const issue = {
    number: 2,
    title: "Invented healthy issue",
    url: "https://synthetic.invalid/issues/2",
    state: "OPEN" as const,
    updatedAt: now,
    author: null,
  };
  const mixed = mergeCompletionRemoteSnapshots([
    {
      items: [issue],
      refreshing: false,
      updatedAt: now,
      failed: false,
      stale: false,
    },
    { items: [], refreshing: false, updatedAt: null, failed: true },
  ]);
  assert.equal(mixed.failed, true);
  assert.equal(mixed.stale, true);
  f.ports.issues = async () => mixed;
  const provider = createCompletionProviders(f.ports).find(
    (source) => source.id === "issues",
  )!;
  const snapshot = await provider.load({ projectId: "p" });
  assert.ok("documents" in snapshot);
  assert.equal(snapshot.status, "stale");
  assert.equal(snapshot.documents.length, 1);
  assert.equal(snapshot.refreshing, false);
  assert.equal("error" in snapshot, false);
  f.ports.issues = async () => ({
    items: [issue],
    refreshing: false,
    updatedAt: now,
    failed: true,
  });
  const warmFailure = await provider.load({ projectId: "p" });
  assert.ok("documents" in warmFailure);
  assert.equal(
    warmFailure.status,
    "stale",
    "a recent timestamp cannot hide an explicit warm failure",
  );
  f.ports.issues = async () => ({
    items: [issue],
    refreshing: false,
    updatedAt: now,
    stale: true,
  });
  const explicitStale = await provider.load({ projectId: "p" });
  assert.ok("documents" in explicitStale);
  assert.equal(explicitStale.status, "stale");
});

void test("launch provider awaits asynchronous catalogs and indexes only current-project running references", async () => {
  const f = setup();
  f.ports.launches = async () => [
    {
      id: "running",
      projectId: "p",
      displayName: "Invented server",
      name: "Invented server",
      status: "running",
      updatedAt: "now",
    },
    {
      id: "foreign",
      projectId: "q",
      displayName: "Foreign",
      name: "Foreign",
      status: "running",
      updatedAt: "now",
    },
    {
      id: "done",
      projectId: "p",
      displayName: "Finished",
      name: "Finished",
      status: "completed",
      updatedAt: "now",
    },
  ];
  const launches = await f.load("launches");
  assert.deepEqual(
    launches.map((document) => document.item.label),
    ["running"],
  );
  assert.equal(launches[0]?.setEnabled, undefined);
});

void test("completion cannot implicitly trust an imported project capability file", async () => {
  const f = setup();
  f.config.trust = {
    status: "untrusted",
    digest: "imported",
    reason: "Explicit trust required",
  };
  for (const source of createCompletionProviders(f.ports).filter(
    (provider) => provider.id === "skills" || provider.id === "tools",
  )) {
    const snapshot = await source.load({ projectId: "p" });
    const documents = "documents" in snapshot ? snapshot.documents : snapshot;
    assert.equal(documents[0]?.item.available, false);
    assert.equal(documents[0]?.item.canDisable, false);
    assert.equal(documents[0]?.setEnabled, undefined);
  }
  const conversationSkill = (await f.load("skills"))[0]!;
  assert.equal(
    conversationSkill.item.available,
    true,
    "a conversation override does not trust the imported project file",
  );
  await conversationSkill.setEnabled?.(true);
  assert.equal((f.updates[0] as { layer: string }).layer, "conversation");
});

void test("remote cache freshness is not fabricated when cached arrays are empty or stale", async () => {
  const f = setup();
  f.ports.issues = async () => ({
    items: [],
    refreshing: true,
    updatedAt: null,
  });
  const provider = createCompletionProviders(f.ports).find(
    (source) => source.id === "issues",
  )!;
  const loading = await provider.load({ projectId: "p" });
  assert.ok("documents" in loading);
  assert.equal(loading.status, "loading");
  assert.equal(loading.refreshing, true);
  f.ports.issues = async () => ({
    items: [],
    refreshing: false,
    updatedAt: new Date(Date.now() - 120_000).toISOString(),
  });
  const stale = await provider.load({ projectId: "p" });
  assert.ok("documents" in stale);
  assert.equal(stale.status, "stale");
  assert.equal(stale.refreshing, false);
});

void test("same-name skill buckets remain distinct and report enabled-source shadowing", async () => {
  const f = setup();
  f.config.effective.enabledNerveSkills = ["hidden"];
  f.ports.skills = async () => [
    {
      name: "hidden",
      description: "File",
      source: "project",
      filePath: "/synthetic/file",
    },
    {
      name: "hidden",
      description: "Builtin",
      source: "nerve",
      filePath: "/synthetic/builtin",
    },
  ];
  const initial = await f.load("skills");
  assert.equal(initial.length, 2);
  assert.notEqual(initial[0]?.id, initial[1]?.id);
  assert.equal(initial[0]?.item.enabled, false);
  assert.equal(initial[1]?.item.enabled, true);
  assert.equal(initial[1]?.item.available, true);
  f.config.effective.disabledFileSkills = [];
  const shadowed = (await f.load("skills"))[1]!;
  assert.equal(shadowed.item.enabled, true);
  assert.equal(shadowed.item.available, false);
  assert.equal(shadowed.item.canDisable, true);
});

void test("disabled authorized skill is discoverable; selection uses scoped digest and source bucket", async () => {
  const f = setup();
  const skills = await f.load("skills");
  assert.equal(
    skills.length,
    1,
    "shadowed copies cannot be separately enabled by name",
  );
  assert.equal(skills[0]?.item.enabled, false);
  assert.equal(skills[0]?.item.available, true);
  await skills[0]?.setEnabled?.(true);
  assert.deepEqual(f.updates[0], {
    projectId: "p",
    conversationId: "c",
    layer: "conversation",
    expectedDigest: "conversation-digest",
    patch: { skills: { file: { hidden: true } } },
  });
});

void test("integration tool toggles owning group/profile; unconfigured resources are not fabricated", async () => {
  const f = setup();
  const tools = await f.load("tools");
  assert.equal(tools[0]?.item.enabled, false);
  assert.equal(tools[0]?.item.available, true);
  await tools[0]?.setEnabled?.(true);
  assert.deepEqual(f.updates[0], {
    projectId: "p",
    conversationId: "c",
    layer: "conversation",
    expectedDigest: "conversation-digest",
    patch: { tools: { jira: { enabled: true, profileId: "profile-1" } } },
  });
  f.config.availableTools = [];
  assert.deepEqual(await f.load("tools"), []);
});

void test("disabled valid profiles can be enabled; untrusted/invalid profiles remain blocked", async () => {
  const f = setup();
  const effective = subagentProfileSchema.parse({
    ...builtInSubagentProfiles[0],
    tools: {},
    enabled: false,
    source: "builtin",
    trust: "trusted",
  });
  const base = {
    scope: "conversation" as const,
    document: null,
    digest: "profile-digest",
    trust: "trusted" as const,
    diagnostics: [],
  };
  f.setProfiles({
    ...base,
    profiles: [
      {
        name: effective.name,
        effective,
        local: null,
        inherited: null,
        trust: "trusted",
        diagnostics: [],
        origins: { fields: {}, tools: {}, skills: {} },
      },
    ],
  });
  const profiles = await f.load("profiles");
  assert.equal(profiles[0]?.item.enabled, false);
  assert.equal(profiles[0]?.item.available, true);
  await profiles[0]?.setEnabled?.(true);
  assert.deepEqual(f.updates[0], {
    scope: "conversation",
    projectId: "p",
    conversationId: "c",
    name: effective.name,
    expectedDigest: "profile-digest",
    patch: { enabled: true },
  });
  f.setProfiles({
    ...base,
    profiles: [
      {
        name: effective.name,
        effective: { ...effective, enabled: true },
        local: null,
        inherited: null,
        trust: "untrusted",
        diagnostics: [],
        origins: { fields: {}, tools: {}, skills: {} },
      },
      {
        name: "invalid",
        effective: null,
        local: null,
        inherited: null,
        trust: "trusted",
        diagnostics: [],
        origins: { fields: {}, tools: {}, skills: {} },
      },
    ],
  });
  const blocked = await f.load("profiles");
  assert.equal(
    blocked[0]?.item.enabled,
    true,
    "enabled reports configuration, not trust or eligibility",
  );
  for (const profile of blocked) {
    assert.equal(profile.item.available, false);
    assert.equal(profile.item.canDisable, false);
    assert.equal(profile.setEnabled, undefined);
  }
});

void test("running subagents are current conversation/project only; files preserve path-field highlighting", async () => {
  const f = setup();
  f.ports.children = () => [
    {
      id: "child",
      title: "Session review",
      projectId: "p",
      parentConversationId: "c",
      status: "running",
      updatedAt: "now",
    },
    {
      id: "foreign",
      title: "Foreign",
      projectId: "q",
      parentConversationId: "c",
      status: "running",
      updatedAt: "now",
    },
    {
      id: "sibling",
      title: "Sibling",
      projectId: "p",
      parentConversationId: "other",
      status: "running",
      updatedAt: "now",
    },
    {
      id: "finished",
      title: "Finished",
      projectId: "p",
      parentConversationId: "c",
      status: "idle",
      updatedAt: "now",
    },
  ];
  const children = await f.load("subagents");
  assert.equal(children.length, 1);
  assert.equal(children[0]?.conversationId, "c");
  const files = await f.load("files");
  assert.deepEqual(files[0]?.fields, [{ key: "path", text: "src/session.ts" }]);
  assert.equal(files[0]?.displayField?.offset, 1);
});
