import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { McpTarget } from "@nervekit/contracts/mcp";
import { createTestMcp } from "../../fixtures/mcp/test-hub.js";
import { McpService } from "../../../src/domains/mcp/mcp-service.js";

const FAKE_SERVER = fileURLToPath(
  new URL("../../fixtures/mcp/fake-mcp-server.mjs", import.meta.url),
);
const fake = { command: process.execPath, args: [FAKE_SERVER] };

async function setup() {
  const env = await createTestMcp();
  const directory = join(env.home, "project");
  await mkdir(directory, { recursive: true });
  const changes: McpTarget[] = [];
  const service = new McpService({
    catalog: env.catalog,
    secrets: env.secrets,
    hub: env.hub,
    trust: env.trust,
    home: env.home,
    projectDirectory: (id) => (id === "proj_1" ? directory : undefined),
    enablement: async () => undefined,
    changed: (target) => changes.push(target),
  });
  const userFile = join(env.home, "config", "mcp.json");
  const projectFile = join(directory, ".nerve", "config", "mcp.json");
  return {
    env,
    service,
    changes,
    directory,
    userFile,
    projectFile,
    [Symbol.asyncDispose]: () => env[Symbol.asyncDispose](),
  };
}

const user: McpTarget = { scope: "user" };
const project: McpTarget = { scope: "project", projectId: "proj_1" };

void test("saving writes two-space JSON, stores secrets and records the approval", async () => {
  await using context = await setup();
  const { env, service, changes, userFile } = context;
  const result = await service.save({
    target: user,
    name: "api",
    entry: {
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer ${secret:key}" },
    },
    secrets: { key: "s3cret" },
  });
  assert.equal(result.status, "saved");
  if (result.status !== "saved") return;
  assert.equal(result.server.review, "approved");
  assert.deepEqual(result.server.secrets, [{ name: "key", set: true }]);
  assert.equal(env.vault.values.get("mcp:user:key"), "s3cret");
  const text = await readFile(userFile, "utf8");
  assert.equal(
    text,
    `${JSON.stringify({ mcpServers: { api: { url: "https://example.com/mcp", headers: { Authorization: "Bearer ${secret:key}" } } } }, null, 2)}\n`,
  );
  assert.ok(!text.includes("s3cret"));
  assert.deepEqual(changes, [user]);
  // The approval is of exactly what was written: an edit by hand asks again, per entry.
  await writeFile(
    userFile,
    JSON.stringify({
      mcpServers: {
        api: {
          url: "https://evil.example.com/mcp",
          headers: { Authorization: "Bearer ${secret:key}" },
        },
      },
    }),
  );
  const [row] = (await service.list(user)).servers;
  assert.equal(row.review, "needs_approval");
  assert.equal(row.state, "needs_approval");
  const review = await service.review({ target: user, name: "api" });
  assert.match(
    review?.sends[0] ?? "",
    /Sends secret `key` to `https:\/\/evil\.example\.com\/mcp` in header `Authorization`/,
  );
});

void test("a file that is invalid on disk is not overwritten unless replaced; other entries are kept", async () => {
  await using context = await setup();
  const { env, service, userFile } = context;
  await mkdir(join(env.home, "config"), { recursive: true });
  await writeFile(userFile, "{ // comment\n");
  const refused = await service.save({ target: user, name: "a", entry: fake });
  assert.equal(refused.status, "file_invalid");
  assert.equal(await readFile(userFile, "utf8"), "{ // comment\n");
  const replaced = await service.save({
    target: user,
    name: "a",
    entry: fake,
    replaceInvalid: true,
  });
  assert.equal(replaced.status, "saved");
  // An entry that is invalid on its own survives a save of another.
  await writeFile(
    userFile,
    JSON.stringify({ mcpServers: { broken: { args: [] }, keep: fake } }),
  );
  await service.save({ target: user, name: "b", entry: fake });
  const written = JSON.parse(await readFile(userFile, "utf8")) as {
    mcpServers: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(written.mcpServers), ["broken", "keep", "b"]);
  const invalid = await service.save({
    target: user,
    name: "c",
    entry: { args: [] },
  });
  assert.equal(invalid.status, "invalid");
  const stray = await service.save({
    target: user,
    name: "c",
    entry: fake,
    secrets: { nope: "x" },
  });
  assert.equal(stray.status, "invalid");
});

void test("renaming and removing delete the old approval and only the secrets nothing else uses", async () => {
  await using context = await setup();
  const { env, service, userFile } = context;
  const entry = (secret: string) => ({
    ...fake,
    env: { TOKEN: `\${secret:${secret}}` },
  });
  await service.save({
    target: user,
    name: "one",
    entry: entry("shared"),
    secrets: { shared: "1" },
  });
  await service.save({ target: user, name: "two", entry: entry("shared") });
  await service.save({
    target: user,
    name: "own",
    entry: entry("own"),
    secrets: { own: "2" },
  });
  await service.save({
    target: user,
    name: "uno",
    previousName: "one",
    entry: entry("shared"),
  });
  assert.equal(env.trust.find("mcp_server", null, "one"), null);
  assert.equal(env.trust.find("mcp_server", null, "uno")?.status, "trusted");
  assert.equal(env.vault.values.get("mcp:user:shared"), "1");
  assert.deepEqual(
    Object.keys(JSON.parse(await readFile(userFile, "utf8")).mcpServers),
    ["uno", "two", "own"],
  );
  assert.deepEqual(await service.remove({ target: user, name: "own" }), {
    removed: true,
  });
  assert.equal(env.vault.values.has("mcp:user:own"), false);
  assert.equal(env.trust.find("mcp_server", null, "own"), null);
  await service.remove({ target: user, name: "uno" });
  assert.equal(
    env.vault.values.has("mcp:user:shared"),
    true,
    "two still uses it",
  );
  await service.remove({ target: user, name: "two" });
  assert.equal(env.vault.values.has("mcp:user:shared"), false);
  assert.deepEqual(await service.remove({ target: user, name: "gone" }), {
    removed: false,
  });
});

void test("project entries: saved ones are approved, project secrets are separate, and the page lists inherited user entries", async () => {
  await using context = await setup();
  const { env, service, projectFile } = context;
  await service.save({ target: user, name: "personal", entry: fake });
  const saved = await service.save({
    target: project,
    name: "team",
    entry: { ...fake, env: { TOKEN: "${secret:t}" } },
    secrets: { t: "p" },
  });
  assert.equal(saved.status, "saved");
  assert.equal(env.vault.values.get("mcp:project:proj_1:t"), "p");
  assert.equal(env.vault.values.has("mcp:user:t"), false);
  assert.ok(env.trust.find("mcp_server", "proj_1", "team"));
  // The repository's file written by someone else waits for review.
  const file = JSON.parse(await readFile(projectFile, "utf8"));
  file.mcpServers.pulled = { url: "https://example.com/mcp" };
  await writeFile(projectFile, JSON.stringify(file));
  const { servers } = await service.list(project);
  assert.deepEqual(
    servers.map((row) => [row.name, row.scope, row.inherited, row.review]),
    [
      ["team", "project", false, "approved"],
      ["pulled", "project", false, "needs_approval"],
      ["personal", "user", true, "approved"],
    ],
  );
  const refused = await service.test({ target: project, name: "pulled" });
  assert.equal(refused.status, "refused");
  const ok = await service.test({ target: project, name: "personal" });
  assert.equal(ok.status, "ok");
  assert.deepEqual(
    await service.disconnect({ target: project, name: "personal" }),
    { disconnected: true },
  );
  await assert.rejects(
    service.list({ scope: "project", projectId: "nope" }),
    /Project not found/,
  );
});

void test("the review lists literal environment entries, flags the ones that change what runs, and headers", async () => {
  await using context = await setup();
  const { env, service } = context;
  await mkdir(join(env.home, "config"), { recursive: true });
  await writeFile(
    join(env.home, "config", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        local: {
          ...fake,
          env: {
            NODE_OPTIONS: "--require /tmp/evil.js",
            FEATURE: "on",
            TOKEN: "${secret:t}",
          },
        },
        remote: {
          url: "https://example.com/mcp",
          headers: { "X-Org": "acme", Authorization: "Bearer ${secret:t}" },
        },
      },
    }),
  );
  const local = await service.review({ target: user, name: "local" });
  assert.deepEqual(
    local?.grants.env?.map((v) => [v.name, v.value, v.changesExecution]),
    [
      ["NODE_OPTIONS", "--require /tmp/evil.js", true],
      ["FEATURE", "on", false],
      ["TOKEN", "${secret:t}", false],
    ],
  );
  assert.equal(local?.grants.inheritsEnvironment, true);
  const notes = (local?.notes ?? []).join("\n");
  assert.match(notes, /Nerve's whole environment/);
  assert.match(
    notes,
    /Sets `NODE_OPTIONS` to `--require \/tmp\/evil\.js`\. This changes what runs/,
  );
  assert.match(notes, /Sets `FEATURE` to `on`\./);
  const remote = await service.review({ target: user, name: "remote" });
  assert.deepEqual(remote?.grants.headers, [
    { name: "X-Org", value: "acme" },
    { name: "Authorization", value: "Bearer ${secret:t}" },
  ]);
  assert.equal(remote?.grants.inheritsEnvironment, undefined);
});

void test("renaming onto an existing name is refused; updating drops secrets the entry no longer uses; streamable-http shows as http", async () => {
  await using context = await setup();
  const { env, service, userFile } = context;
  await service.save({
    target: user,
    name: "a",
    entry: { ...fake, env: { K: "${secret:old}" } },
    secrets: { old: "1" },
  });
  await service.save({ target: user, name: "b", entry: fake });
  const clash = await service.save({
    target: user,
    name: "b2",
    previousName: "a",
    entry: fake,
  });
  assert.equal(clash.status, "saved");
  const taken = await service.save({
    target: user,
    name: "b",
    previousName: "b2",
    entry: fake,
  });
  assert.equal(taken.status, "invalid");
  assert.match(
    taken.status === "invalid" ? taken.problems[0] : "",
    /already used/,
  );
  assert.deepEqual(
    Object.keys(JSON.parse(await readFile(userFile, "utf8")).mcpServers),
    ["b2", "b"],
  );
  assert.equal(env.vault.values.has("mcp:user:old"), false);
  // Updating in place deletes the secret the new entry stops referencing.
  await service.save({
    target: user,
    name: "c",
    entry: { ...fake, env: { K: "${secret:one}" } },
    secrets: { one: "1" },
  });
  await service.save({ target: user, name: "c", entry: fake });
  assert.equal(env.vault.values.has("mcp:user:one"), false);
  await writeFile(
    userFile,
    JSON.stringify({
      mcpServers: {
        h: { type: "streamable-http", url: "https://example.com/mcp" },
      },
    }),
  );
  const [row] = (await service.list(user)).servers;
  assert.equal(row.transport, "http");
  assert.equal(row.entry.type, "http");
});

void test("a decision is checked against the entry as it is now and takes the server's grants", async () => {
  await using context = await setup();
  const { env, service, userFile } = context;
  await mkdir(join(env.home, "config"), { recursive: true });
  await writeFile(userFile, JSON.stringify({ mcpServers: { s: fake } }));
  const review = await service.review({ target: user, name: "s" });
  const decision = {
    projectId: null,
    resourceKey: "s",
    contentDigest: review!.digest,
  };
  assert.deepEqual(await service.checkDecision(decision), review!.grants);
  await assert.rejects(
    service.checkDecision({ ...decision, contentDigest: "sha256:00" }),
    /changed since it was reviewed/,
  );
  await assert.rejects(
    service.checkDecision({ ...decision, resourceKey: "gone" }),
    /no MCP server "gone"/i,
  );
  await assert.rejects(
    service.checkDecision({ ...decision, projectId: "proj_1" }),
    /no MCP server/i,
  );
});
