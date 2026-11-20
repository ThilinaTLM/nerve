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
    home,
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

void test("reload makes a newly written invalid profile visible; status keeps the last load", async (t) => {
  const { home, port } = await setup(t);
  assert.deepEqual(await port.reload("user"), { diagnostics: [] });
  const file = join(home, "agent", "agent-profiles", "reviewer.json");
  await writeFile(file, "{ not json");
  assert.deepEqual(await port.status("user"), { diagnostics: [] });
  const { diagnostics } = await port.reload("user");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].scope, "user");
  assert.equal(diagnostics[0].document, "profile:reviewer");
  assert.equal(diagnostics[0].path, file);
  assert.deepEqual(await port.status("user"), { diagnostics });
});

void test("reload reports invalid permission files and rule sets, and reloads the policy source", async (t) => {
  const { home, port, reloaded } = await setup(t);
  await writeFile(
    join(home, "config", "permissions.json"),
    JSON.stringify({ schemaVersion: 2, overlays: "nope" }),
  );
  await mkdir(join(home, "config", "rule-sets"), { recursive: true });
  await writeFile(join(home, "config", "rule-sets", "mine.json"), "{}");
  const { diagnostics } = await port.reload("user");
  assert.deepEqual(
    [...new Set(diagnostics.map((entry) => entry.document))].sort(),
    ["permissions.json", "rule-set:mine"],
  );
  assert.equal(
    diagnostics.find((entry) => entry.document === "permissions.json")!.pointer,
    "/overlays",
  );
  assert.deepEqual(reloaded, [undefined]);
});

void test("an invalid edit of a loaded permission file keeps the previous version and says so", async (t) => {
  const { home, port } = await setup(t);
  const file = join(home, "config", "permissions.json");
  await writeFile(file, JSON.stringify({ schemaVersion: 2, overlays: [] }));
  assert.deepEqual(await port.reload("user"), { diagnostics: [] });
  await writeFile(file, "{ not json");
  // `status` checks the disk and activates nothing.
  const checked = await port.status("user");
  assert.equal(checked.diagnostics[0].code, "malformed-json");
  assert.doesNotMatch(checked.diagnostics[0].message, /stays in use/);
  const { diagnostics } = await port.reload("user");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].level, "error");
  assert.match(diagnostics[0].message, /stays in use/);
});

void test("project reload flags an unapproved overlay as untrusted and never trusts it", async (t) => {
  const { project, port, reloaded } = await setup(t);
  const file = join(project, ".nerve", "config", "permissions.json");
  await writeFile(
    file,
    JSON.stringify({ version: 3, schemaVersion: 2, overlays: [] }),
  );
  const { diagnostics } = await port.reload("project");
  assert.deepEqual(
    diagnostics.map(({ document, level, code }) => ({ document, level, code })),
    [{ document: "permissions.json", level: "warning", code: "untrusted" }],
  );
  assert.deepEqual(reloaded, [[file]]);
});

void test("valid lead and sub-agent profiles report nothing; an invalid field is explained", async (t) => {
  const { home, port } = await setup(t);
  const profile = (name: string, usableBy: string) =>
    writeFile(
      join(home, "agent", "agent-profiles", `${name}.json`),
      JSON.stringify({
        schemaVersion: 1,
        name,
        whenToUse: "Review a finished change.",
        usableBy,
        instructions: "",
      }),
    );
  await profile("reviewer", "subagent");
  await profile("writer", "lead");
  assert.deepEqual(await port.reload("user"), { diagnostics: [] });
  await profile("reviewer", "teammate");
  const { diagnostics } = await port.reload("user");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].level, "error");
  assert.equal(diagnostics[0].pointer, "/usableBy");
  assert.match(
    diagnostics[0].message,
    /^Invalid value\. .* Detail: Invalid option/,
  );
});

void test("project status reports an unreadable launch catalog", async (t) => {
  const { port, setLaunchProblem } = await setup(t);
  setLaunchProblem({
    path: "/p/.nerve/launches/definitions.json",
    reason: "x",
  });
  assert.deepEqual(
    (await port.status("project")).diagnostics.map(({ document, path }) => ({
      document,
      path,
    })),
    [{ document: "launches", path: "/p/.nerve/launches/definitions.json" }],
  );
  assert.deepEqual(await port.status("user"), { diagnostics: [] });
});
