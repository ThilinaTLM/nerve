import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capabilityConfigurationSchema,
  emptyCapabilityOverrides,
} from "@nervekit/contracts/capabilities";
import { defaultSettings } from "@nervekit/contracts/settings";
import {
  builtInAgentProfiles,
  agentProfileSchema,
  type AgentProfilesConfiguration,
} from "@nervekit/contracts/agent-profiles";
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
  let profiles: AgentProfilesConfiguration = {
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
    setProfiles(next: AgentProfilesConfiguration) {
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
  assert.equal(initial[0]?.item.detail, "File");
  assert.equal(initial[0]?.item.info, "project");
  assert.equal(initial[1]?.item.detail, "Builtin");
  assert.equal(initial[1]?.item.info, "nerve");
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
  const effective = agentProfileSchema.parse({
    ...builtInAgentProfiles[0],
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

void test("entity states are lowercase badges, not duplicated context, and context highlights remain aligned", async () => {
  const f = setup();
  f.ports.prs = async () => ({
    refreshing: false,
    updatedAt: new Date().toISOString(),
    items: ["OPEN", "MERGED", "CLOSED", "OPEN"].map((state, index) => ({
      number: index + 1,
      title: `PR ${index}`,
      url: `https://synthetic.invalid/pr/${index}`,
      state,
      isDraft: index === 3,
      headRefName: "feature/context",
      author: "alice",
      repository: "nested",
      updatedAt: "now",
    })),
  });
  f.ports.issues = async () => ({
    refreshing: false,
    updatedAt: new Date().toISOString(),
    items: (["OPEN", "CLOSED"] as const).map((state, index) => ({
      number: index + 1,
      title: `Issue ${index}`,
      url: `https://synthetic.invalid/issue/${index}`,
      state,
      author: index ? null : "alice",
      repository: "nested",
      updatedAt: "now",
    })),
  });
  const prs = await f.load("pull_requests");
  assert.deepEqual(
    prs.map((doc) => doc.item.status),
    ["open", "merged", "closed", "draft"],
  );
  assert.ok(
    prs.every((doc) => doc.item.detail === "feature/context · alice · nested"),
  );
  const issues = await f.load("issues");
  assert.deepEqual(
    issues.map((doc) => doc.item.status),
    ["open", "closed"],
  );
  assert.deepEqual(
    issues.map((doc) => doc.item.detail),
    ["alice · nested", "nested"],
  );
  for (const doc of [...prs, ...issues]) {
    for (const field of doc.detailFields ?? []) {
      const text = doc.fields[field.index]!.text;
      assert.equal(
        doc.item.detail?.slice(field.offset, field.offset + text.length),
        text,
        `${doc.kind} context field ${field.index}`,
      );
    }
  }
});

void test("active launch and subagent states are separate from their context IDs", async () => {
  const f = setup();
  f.ports.launches = () =>
    (["starting", "running", "ready", "stopping"] as const).map(
      (status, index) => ({
        id: `launch-${index}`,
        projectId: "p",
        name: "Preview",
        status,
        updatedAt: "now",
      }),
    );
  f.ports.children = () =>
    (["running", "queued", "waiting", "stopping"] as const).map(
      (status, index) => ({
        id: `child-${index}`,
        projectId: "p",
        parentConversationId: "c",
        title: "Review",
        status,
        updatedAt: "now",
      }),
    );
  const launches = await f.load("launches");
  assert.deepEqual(
    launches.map((doc) => doc.item.status),
    ["starting", "running", "ready", "stopping"],
  );
  const children = await f.load("subagents");
  assert.deepEqual(
    children.map((doc) => doc.item.status),
    ["running", "queued", "waiting", "stopping"],
  );
  for (const doc of [...launches, ...children]) {
    assert.equal(doc.item.detail, doc.fields[1]!.text);
    assert.equal(doc.detailFields?.[0]?.offset, 0);
  }
});

void test("remote failures survive repository merging and appear on stale as well as unavailable sources", async () => {
  const f = setup();
  const snapshot = mergeCompletionRemoteSnapshots([
    {
      items: [],
      refreshing: false,
      failed: true,
      failureCode: "GH_AUTH_REQUIRED",
      updatedAt: null,
    },
  ]);
  for (const id of ["pull_requests", "issues"] as const) {
    f.ports.prs = async () => snapshot;
    f.ports.issues = async () => snapshot;
    const provider = createCompletionProviders(f.ports).find(
      (provider) => provider.id === id,
    )!;
    const unavailable = await provider.load({ projectId: "p" });
    assert.ok("documents" in unavailable);
    assert.equal(unavailable.status, "unavailable");
    assert.equal(unavailable.reason, "GitHub CLI isn’t signed in.");
    assert.equal(unavailable.action, "open_pull_requests");
    const cached = {
      ...snapshot,
      failureCode: "GH_API_UNAVAILABLE",
      updatedAt: new Date().toISOString(),
    };
    f.ports.prs = async () => cached;
    f.ports.issues = async () => cached;
    const stale = await provider.load({ projectId: "p" });
    assert.ok("documents" in stale);
    assert.equal(stale.status, "stale");
    assert.equal(
      stale.reason,
      "GitHub is unreachable — showing cached results.",
    );
    assert.equal(stale.action, undefined);
  }
});
