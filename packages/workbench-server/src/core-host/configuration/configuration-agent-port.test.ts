import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import type { CoreStorage } from "@nervekit/conversation-core";
import { createScopedPermissionSource } from "../permissions/scoped-permission-source.js";
import { createConfigurationAgentPort } from "./configuration-agent-port.js";

async function setup(t: test.TestContext) {
  const home = await mkdtemp(join(tmpdir(), "nerve-config-port-"));
  const project = join(home, "project");
  await mkdir(join(home, "config"), { recursive: true });
  await mkdir(join(home, "agent", "agent-profiles"), { recursive: true });
  await mkdir(join(project, ".nerve", "config"), { recursive: true });
  await mkdir(join(project, ".nerve", "agent-profiles"), {
    recursive: true,
  });
  const service = new AgentConfigurationService({
    home,
    projectDirectory: () => project,
    conversationOwner: () => ({ projectId: "p", role: "lead" }),
    builtins: {},
    isProfileTrusted: () => false,
    captureResources: () => ({ options: {}, isCurrent: () => true }),
  });
  t.after(async () => {
    await service.flushSummaries();
    await rm(home, { recursive: true, force: true });
  });
  // The real source: it owns the validation the port reports.
  const source = createScopedPermissionSource({
    home,
    storage: {} as CoreStorage,
    agents: service,
    trustGeneration: () => 0,
    requestGenerations: () => undefined,
  });
  const reloaded: (readonly string[] | undefined)[] = [];
  let launchProblem: { path: string; reason: string } | undefined;
  const port = createConfigurationAgentPort({
    service,
    policy: {
      check: (paths) => source.check(paths),
      reload: (paths) => {
        reloaded.push(paths);
        return source.reload(paths);
      },
    },
    conversationId: "c",
    trustedResources: { find: () => null },
    launchDefinitions: { problem: async () => launchProblem },
  });
  return {
    home,
    project,
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

void test("project reload flags an unapproved overlay as needing approval and never trusts it", async (t) => {
  const { project, port, reloaded } = await setup(t);
  const file = join(project, ".nerve", "config", "permissions.json");
  await writeFile(
    file,
    JSON.stringify({ version: 3, schemaVersion: 2, overlays: [] }),
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
        state: "needs_approval",
        approval: "trust",
        codes: ["warning:untrusted"],
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
