import { McpCatalog } from "../../domains/mcp/mcp-catalog.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import {
  TrustedResourceService,
  type CoreStorage,
} from "@nervekit/conversation-core";
import { createScopedPermissionSource } from "../permissions/scoped-permission-source.js";
import { createResourceRegistry } from "./create-resource-registry.js";
import { createConfigurationAgentPort } from "./configuration-agent-port.js";

async function setup(t: test.TestContext) {
  const home = await mkdtemp(join(tmpdir(), "nerve-config-port-"));
  const project = join(home, "project");
  // Skills under the OS home are the user's too; keep the developer's own out of the test.
  const osHome = process.env.HOME;
  process.env.HOME = join(home, "os-home");
  t.after(() => {
    process.env.HOME = osHome;
  });
  await mkdir(join(home, "config"), { recursive: true });
  await mkdir(join(home, "agent", "agent-profiles"), { recursive: true });
  await mkdir(join(project, ".nerve", "config"), { recursive: true });
  await mkdir(join(project, ".nerve", "agent-profiles"), {
    recursive: true,
  });
  // The user's own files are trusted in these tests; the project's follow the stored decisions.
  const userDecision = { id: "user", status: "trusted", contentDigest: "" };
  const trusting = {
    trustedResources: {
      find: (_kind: string, projectId: string | null) =>
        projectId === null ? userDecision : null,
    },
  } as unknown as CoreStorage;
  const trust = new TrustedResourceService(trusting, () => "");
  const decided = trust.trustState.bind(trust);
  trust.trustState = (row, digest) =>
    row === userDecision ? "trusted" : decided(row, digest);
  const service = new AgentConfigurationService({
    home,
    projectDirectory: () => project,
    conversationOwner: () => ({ projectId: "p", role: "lead" }),
    builtins: {},
    profileTrustState: (projectId) =>
      projectId === null ? "trusted" : "needs_review",
    captureResources: () => ({ options: {}, isCurrent: () => true }),
  });
  t.after(async () => {
    await service.flushSummaries();
    await rm(home, { recursive: true, force: true });
  });
  // The real source: it owns the validation the port reports.
  const source = createScopedPermissionSource({
    home,
    storage: trusting,
    trust,
    agents: service,
    trustGeneration: () => 0,
    requestGenerations: () => undefined,
  });
  const reloaded: (readonly string[] | undefined)[] = [];
  let launchProblem: { path: string; reason: string } | undefined;
  const policy = Object.assign(Object.create(source) as typeof source, {
    reload: (paths?: readonly string[]) => {
      reloaded.push(paths);
      return source.reload(paths);
    },
  });
  const registry = createResourceRegistry({
    home,
    mcpCatalog: new McpCatalog({
      home,
      trust: { state: () => "needs_review" },
    }),
    agentConfiguration: service,
    policy,
    trust: {
      find: () => null,
      state: (_kind, projectId) =>
        projectId === null ? "trusted" : "needs_review",
      trustState: (row, digest) => trust.trustState(row, digest),
    },
    launchDefinitions: { problem: async () => launchProblem },
    extensionCatalog: { entries: async () => [], reload: async () => {} },
    builtinSkills: () => [],
  });
  const port = createConfigurationAgentPort({
    registry,
    agentConfiguration: service,
    policy,
    home,
    conversationId: "c",
    projectDirectory: project,
    cwd: project,
    availableModels: () => [{ provider: "openai", modelId: "gpt" }],
  });
  return {
    home,
    project,
    registry,
    port,
    reloaded,
    service,
    setLaunchProblem: (value: { path: string; reason: string }) => {
      launchProblem = value;
    },
  };
}

const VALID_PROFILE = (name: string, usableBy = "lead") =>
  JSON.stringify({
    schemaVersion: 1,
    name,
    whenToUse: "Review a finished change.",
    usableBy,
    instructions: "",
  });

void test("check reads the disk and activates nothing; reload makes a new invalid profile visible", async (t) => {
  const { home, port } = await setup(t);
  assert.deepEqual(await port.reload("user"), { resources: [] });
  const file = join(home, "agent", "agent-profiles", "reviewer.json");
  await writeFile(file, "{ not json");
  const checked = await port.check("user");
  assert.deepEqual(
    checked.resources.map(({ kind, id, path, state }) => ({
      kind,
      id,
      path,
      state,
    })),
    [{ kind: "agent-profile", id: "reviewer", path: file, state: "invalid" }],
  );
  assert.equal(checked.resources[0].diagnostics[0].code, "malformed-json");
  assert.deepEqual(await port.reload("user"), checked);
});

void test("reload reports invalid permission files and rule sets, and reloads the policy source", async (t) => {
  const { home, port, reloaded } = await setup(t);
  await writeFile(
    join(home, "config", "permissions.json"),
    JSON.stringify({ schemaVersion: 2, overlays: "nope" }),
  );
  await mkdir(join(home, "config", "rule-sets"), { recursive: true });
  await writeFile(join(home, "config", "rule-sets", "mine.json"), "{}");
  const { resources } = await port.reload("user");
  assert.deepEqual(
    resources.map(({ kind, id, state }) => ({ kind, id, state })),
    [
      { kind: "permission-overlay", id: "permissions.json", state: "invalid" },
      { kind: "rule-set", id: "mine", state: "invalid" },
    ],
  );
  assert.equal(resources[0].diagnostics[0].pointer, "/overlays");
  assert.deepEqual(reloaded, [undefined]);
});

void test("an invalid edit of a loaded file keeps the previous version and says so", async (t) => {
  const { home, port, service } = await setup(t);
  const overlay = join(home, "config", "permissions.json");
  const profile = join(home, "agent", "agent-profiles", "reviewer.json");
  await writeFile(overlay, JSON.stringify({ schemaVersion: 2, overlays: [] }));
  await writeFile(profile, VALID_PROFILE("reviewer"));
  assert.deepEqual(await port.reload("user"), { resources: [] });
  await writeFile(overlay, "{ not json");
  await writeFile(profile, "{ not json");
  await writeFile(join(home, "config", "agent.json"), "{ not json");
  const { resources } = await port.reload("user");
  assert.deepEqual(
    resources
      .map(({ kind, state, previousVersionActive }) => ({
        kind,
        state,
        previousVersionActive,
      }))
      .sort((a, b) => a.kind.localeCompare(b.kind)),
    ["agent-preferences", "agent-profile", "permission-overlay"].map(
      (kind) => ({ kind, state: "active", previousVersionActive: true }),
    ),
  );
  assert.ok(
    resources.every((resource) => resource.diagnostics[0].level === "error"),
  );
  // What was loaded stays loaded: tool calls keep working.
  assert.notEqual(
    (await service.ensureLoaded({ scope: "user" })).status,
    "unavailable",
  );
});

void test("warnings report mistakes that load; preferences selecting a missing rule set are not activated", async (t) => {
  const { home, port, service } = await setup(t);
  await mkdir(join(home, "config", "rule-sets"), { recursive: true });
  await writeFile(
    join(home, "config", "rule-sets", "mine.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "other",
      name: "Mine",
      source: "user",
      enabled: true,
      rules: [
        {
          id: "shell",
          enabled: true,
          priority: 1,
          enforcement: "overridable",
          when: { toolNames: ["Bash"] },
          decision: "allow",
        },
        {
          id: "any-shell",
          enabled: true,
          priority: 2,
          enforcement: "overridable",
          when: { toolNames: ["bash"] },
          decision: "allow",
        },
      ],
    }),
  );
  await writeFile(
    join(home, "config", "permissions.json"),
    JSON.stringify({
      schemaVersion: 2,
      overlays: [{ ruleSetId: "nope", rules: [] }],
    }),
  );
  const { resources } = await port.reload("user");
  assert.deepEqual(
    resources.map(({ kind, state, diagnostics }) => ({
      kind,
      state,
      codes: diagnostics.map(({ level, code }) => `${level}:${code}`),
    })),
    [
      {
        kind: "permission-overlay",
        state: "active",
        codes: ["warning:unknown-rule-set"],
      },
      {
        kind: "rule-set",
        state: "active",
        codes: [
          "warning:rule-set-id-mismatch",
          "warning:unknown-tool-name",
          "warning:unbounded-allow",
        ],
      },
    ],
  );
  assert.match(
    resources[1].diagnostics[1].message,
    /Use "bash"/,
    "a name that differs only in casing gets the right one",
  );
  // Selecting a rule set that does not exist would block every tool call.
  const agent = join(home, "config", "agent.json");
  await writeFile(
    agent,
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      overrides: { permissionRuleSetId: "missing" },
    }),
  );
  const checked = await port.check("user");
  const preferences = checked.resources.find(
    (resource) => resource.kind === "agent-preferences",
  );
  assert.equal(preferences?.state, "invalid");
  assert.equal(
    preferences?.diagnostics[0].pointer,
    "/overrides/permissionRuleSetId",
  );
  const reloaded = (await port.reload("user")).resources.find(
    (resource) => resource.kind === "agent-preferences",
  );
  assert.equal(reloaded?.previousVersionActive, true);
  const state = await service.ensureLoaded({ scope: "user" });
  assert.equal(
    state.status !== "unavailable" &&
      state.value.document.overrides.permissionRuleSetId,
    undefined,
  );
});

void test("project reload flags an unapproved overlay as needing approval and never trusts it", async (t) => {
  const { project, port, reloaded } = await setup(t);
  const file = join(project, ".nerve", "config", "permissions.json");
  await writeFile(
    file,
    JSON.stringify({ version: 4, schemaVersion: 2, overlays: [] }),
  );
  const { resources } = await port.reload("project");
  assert.deepEqual(
    resources.map(({ kind, state, approval, diagnostics }) => ({
      kind,
      state,
      approval: approval?.kind,
      codes: diagnostics.map(({ level, code }) => `${level}:${code}`),
    })),
    [
      {
        kind: "permission-overlay",
        state: "needs_review",
        approval: "trust",
        codes: ["warning:needs-review"],
      },
    ],
  );
  assert.deepEqual(reloaded, [[file]]);
});

void test("valid lead and sub-agent profiles report nothing; an invalid field is explained", async (t) => {
  const { home, port } = await setup(t);
  const profile = (name: string, usableBy: string) =>
    writeFile(
      join(home, "agent", "agent-profiles", `${name}.json`),
      VALID_PROFILE(name, usableBy),
    );
  await profile("lead-only", "lead");
  await profile("helper", "subagent");
  assert.deepEqual(await port.reload("user"), { resources: [] });
  await profile("reviewer", "teammate");
  const { resources } = await port.reload("user");
  assert.equal(resources.length, 1);
  const [diagnostic] = resources[0].diagnostics;
  assert.equal(diagnostic.level, "error");
  assert.equal(diagnostic.pointer, "/usableBy");
  assert.match(
    diagnostic.message,
    /^Invalid value\. .* Detail: Invalid option/,
  );
});

void test("a profile that names a missing rule set loads with a warning", async (t) => {
  const { home, port } = await setup(t);
  await writeFile(
    join(home, "agent", "agent-profiles", "careful.json"),
    JSON.stringify({
      ...JSON.parse(VALID_PROFILE("careful", "lead")),
      requirements: { permissionRuleSetId: "no-such-set" },
    }),
  );
  for (const { resources } of [
    await port.check("user"),
    await port.reload("user"),
  ]) {
    assert.equal(resources.length, 1);
    assert.equal(resources[0].state, "active");
    assert.deepEqual(
      resources[0].diagnostics.map((entry) => [entry.code, entry.pointer]),
      [["unknown-rule-set", "/requirements/permissionRuleSetId"]],
    );
  }
});

void test("the project scope reports an unreadable launch catalog", async (t) => {
  const { port, setLaunchProblem } = await setup(t);
  setLaunchProblem({
    path: "/p/.nerve/launches/definitions.json",
    reason: "x",
  });
  assert.deepEqual(
    (await port.check("project")).resources.map(({ kind, path, state }) => ({
      kind,
      path,
      state,
    })),
    [
      {
        kind: "launch-catalog",
        path: "/p/.nerve/launches/definitions.json",
        state: "invalid",
      },
    ],
  );
  assert.deepEqual(await port.check("user"), { resources: [] });
});

void test("list shows every resource after precedence, with built-ins in the user scope", async (t) => {
  const { home, project, registry } = await setup(t);
  const skill = (name: string) =>
    `---\nname: ${name}\ndescription: ${name} guidance\n---\nBody\n`;
  for (const root of [
    join(home, "agent", "skills"),
    join(project, ".nerve", "skills"),
  ]) {
    await mkdir(join(root, "review"), { recursive: true });
    await writeFile(join(root, "review", "SKILL.md"), skill("review"));
  }
  await writeFile(
    join(home, "agent", "agent-profiles", "reviewer.json"),
    VALID_PROFILE("reviewer"),
  );
  const context = { projectId: "p", projectDirectory: project };
  const user = await registry.list({ scope: "user", ...context });
  const pick = (kind: string) =>
    user
      .filter((resource) => resource.kind === kind)
      .map(({ id, scope, state, shadowedBy }) => ({
        id,
        scope,
        state,
        shadowedBy,
      }));
  assert.ok(
    pick("rule-set").some(
      (entry) => entry.scope === "builtin" && entry.state === "active",
    ),
  );
  assert.deepEqual(
    pick("agent-profile").filter((entry) => entry.id === "reviewer"),
    [{ id: "reviewer", scope: "user", state: "active", shadowedBy: undefined }],
  );
  // The machine's own ~/.agents/skills is a user root too; look at this test's skill only.
  assert.deepEqual(
    pick("skill").filter((entry) => entry.id === "review"),
    [{ id: "review", scope: "user", state: "shadowed", shadowedBy: "project" }],
  );
  const inProject = await registry.list({ scope: "project", ...context });
  assert.deepEqual(
    inProject.map(({ kind, id, state }) => ({ kind, id, state })),
    [{ kind: "skill", id: "review", state: "needs_review" }],
  );
});
