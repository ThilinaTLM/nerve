import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
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
  const reloaded: (readonly string[] | undefined)[] = [];
  const port = createConfigurationAgentPort({
    service,
    policy: {
      reload: async (paths) => {
        reloaded.push(paths);
      },
    },
    home,
    conversationId: "c",
    trustedResources: { find: () => null },
  });
  return { home, project, port, reloaded, service };
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
  assert.deepEqual(diagnostics.map((entry) => entry.document).sort(), [
    "permissions.json",
    "rule-set:mine",
  ]);
  assert.match(
    diagnostics.find((entry) => entry.document === "permissions.json")!.message,
    /overlays/,
  );
  assert.deepEqual(reloaded, [undefined]);
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
    diagnostics.map(({ document, trust }) => ({ document, trust })),
    [{ document: "permissions.json", trust: "untrusted" }],
  );
  assert.deepEqual(reloaded, [[file]]);
});
