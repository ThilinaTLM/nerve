import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mcpBlock } from "./mcp-server-hub.js";
import { createTestMcp } from "./mcp-test-fixture.js";

const FAKE_SERVER = fileURLToPath(
  new URL("../../../test/fixtures/mcp/fake-mcp-server.mjs", import.meta.url),
);

const fake = (extra: Record<string, unknown> = {}) => ({
  command: process.execPath,
  args: [FAKE_SERVER],
  ...extra,
});

async function setup(
  servers: Record<string, unknown>,
  options: Parameters<typeof createTestMcp>[0] = {},
) {
  const env = await createTestMcp(options);
  await writeUser(env.home, servers);
  return env;
}

const writeUser = async (home: string, servers: Record<string, unknown>) => {
  await mkdir(join(home, "config"), { recursive: true });
  await writeFile(
    join(home, "config", "mcp.json"),
    JSON.stringify({ mcpServers: servers }),
  );
};

const writeProject = async (
  directory: string,
  servers: Record<string, unknown>,
) => {
  await mkdir(join(directory, ".nerve", "config"), { recursive: true });
  await writeFile(
    join(directory, ".nerve", "config", "mcp.json"),
    JSON.stringify({ mcpServers: servers }),
  );
};

void test("starts a stdio server on first use, lists and calls its tools, and reuses the connection", async () => {
  await using env = await setup({
    fake: fake({ description: "Fake", env: { FAKE_MCP_TOKEN: "${HOME}" } }),
    off: fake({ enabled: false }),
  });
  await env.approveAll();
  const port = env.hub.port(env.run());
  assert.deepEqual(
    (await port.listServers()).map((server) => [
      server.name,
      server.scope,
      server.state,
    ]),
    [
      ["fake", "user", "idle"],
      ["off", "user", "disabled"],
    ],
  );
  const tools = await port.listTools("fake");
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["echo", "add", "pixel", "fail", "crash", "whereami"],
  );
  assert.equal(tools[0].annotations?.readOnlyHint, true);
  const sum = await port.callTool("fake", "add", { a: 2, b: 3 });
  assert.deepEqual(sum.structuredContent, { sum: 5 });
  const where = await port.callTool("fake", "whereami", {});
  const text = (where.content[0] as { text: string }).text;
  assert.deepEqual(JSON.parse(text), {
    cwd: env.home,
    token: process.env.HOME,
  });
  const [server] = await port.listServers();
  assert.equal(server.state, "connected");
  assert.equal(server.instructions, "Use echo to test.");
  assert.deepEqual(server.server, { name: "fake-mcp", version: "1.0.0" });
  assert.deepEqual(await port.readResource("fake", "fake://readme"), [
    { uri: "fake://readme", mimeType: "text/plain", text: "Fake readme" },
  ]);
});

void test("unknown and failing servers fail with the reason", async () => {
  await using env = await setup({
    fake: fake(),
    broken: { command: process.execPath, args: ["-e", "process.exit(3)"] },
  });
  await env.approveAll();
  const port = env.hub.port(env.run());
  await assert.rejects(port.listTools("nope"), {
    code: "NOT_FOUND",
    message: /No MCP server "nope"\. Configured: fake, broken\./,
  });
  await assert.rejects(port.listTools("broken"), {
    code: "SERVER_ERROR",
    message: /MCP server "broken" could not start/,
  });
  const broken = (await port.listServers()).find(
    (server) => server.name === "broken",
  );
  assert.equal(broken?.state, "failed");
  await assert.rejects(port.callTool("fake", "nope", {}), {
    code: "NOT_FOUND",
    message: /has no tool "nope"\. Its tools: echo, add/,
  });
});

void test("a server that exits or idles out is started again on the next call", async () => {
  await using env = await setup({ fake: fake() }, { idleMs: 200 });
  await env.approveAll();
  const port = env.hub.port(env.run());
  await port.callTool("fake", "echo", { text: "a" });
  await assert.rejects(port.callTool("fake", "crash", {}), {
    code: "SERVER_ERROR",
  });
  const echoed = await port.callTool("fake", "echo", { text: "b" });
  assert.deepEqual(echoed.content, [{ type: "text", text: "b" }]);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal((await port.listServers())[0].state, "idle");
  const again = await port.callTool("fake", "echo", { text: "c" });
  assert.deepEqual(again.content, [{ type: "text", text: "c" }]);
});

void test("a missing variable or secret shows as failed and names where to set it; an invalid file says so", async () => {
  await using env = await setup({
    needs: fake({
      env: { T: "${NERVE_TEST_UNSET_VARIABLE}", S: "${secret:token}" },
    }),
  });
  await env.approveAll();
  const port = env.hub.port(env.run());
  const [server] = await port.listServers();
  assert.equal(server.state, "failed");
  assert.match(server.error ?? "", /NERVE_TEST_UNSET_VARIABLE is not set/);
  assert.match(
    server.error ?? "",
    /secret token is not set; the user adds it in User settings → Connections → MCP servers/,
  );
  await writeFile(join(env.home, "config", "mcp.json"), "{ nope");
  await assert.rejects(port.listTools("needs"), {
    code: "NOT_FOUND",
    message: /mcp\.json is invalid: not valid JSON/,
  });
});

void test("an entry that is not approved is never started, indexed or listed with tools", async () => {
  let started = 0;
  await using env = await setup(
    { fake: fake() },
    {
      transport: () => {
        started += 1;
        throw new Error("must not start");
      },
    },
  );
  const port = env.hub.port(env.run());
  assert.deepEqual(
    (await port.listServers()).map((server) => [server.name, server.state]),
    [["fake", "needs_approval"]],
  );
  for (const call of [
    () => port.listTools("fake"),
    () => port.callTool("fake", "echo", { text: "x" }),
    () => port.listResources("fake"),
  ])
    await assert.rejects(call(), {
      code: "FORBIDDEN",
      message:
        /Waiting for the user's approval.*User settings → Connections → MCP servers/,
    });
  assert.equal(started, 0);
  await access(join(env.home, "cache", "mcp")).then(
    () => assert.fail("nothing is indexed"),
    () => undefined,
  );
  // A rejected entry stays off; an edited entry asks again.
  const [entry] = (await env.catalog.load()).active;
  env.trust.decide({
    projectId: null,
    resourceKey: "fake",
    contentDigest: entry.digest,
    status: "rejected",
  });
  assert.equal((await port.listServers())[0].state, "rejected");
  await writeUser(env.home, { fake: fake({ timeout: 5 }) });
  assert.equal((await port.listServers())[0].state, "needs_approval");
  assert.equal(started, 0);
});

void test("approval is per entry: adding a server leaves the others approved", async () => {
  await using env = await setup({ one: fake() });
  await env.approveAll();
  await writeUser(env.home, { one: fake(), two: fake() });
  const states = (await env.hub.port(env.run()).listServers()).map((server) => [
    server.name,
    server.state,
  ]);
  assert.deepEqual(states, [
    ["one", "idle"],
    ["two", "needs_approval"],
  ]);
});

void test("settings turn a server off or on per name, above the entry's own enabled", async () => {
  let started = 0;
  await using env = await setup(
    { on: fake(), off: fake({ enabled: false }), other: fake() },
    {
      transport: () => {
        started += 1;
        throw new Error("no start");
      },
    },
  );
  await env.approveAll();
  const disabled = env.hub.port(env.run({ on: false, off: true }));
  assert.deepEqual(
    (await disabled.listServers()).map((server) => [server.name, server.state]),
    [
      ["on", "disabled"],
      ["off", "idle"],
      ["other", "idle"],
    ],
  );
  await assert.rejects(disabled.listTools("on"), {
    code: "FORBIDDEN",
    message: /Turned off in the settings/,
  });
  assert.equal(started, 0);
  assert.equal(
    await env.hub.hasEnabledServers(
      env.run({ on: false, off: false, other: false }),
    ),
    false,
  );
  assert.equal(await env.hub.hasEnabledServers(env.run({ off: true })), true);
});

void test("an approved project entry replaces the user entry whole; a pending one does not", async () => {
  await using env = await setup({ shared: fake({ description: "user" }) });
  const project = {
    projectId: "proj_1",
    projectDirectory: join(env.home, "p"),
  };
  await writeProject(project.projectDirectory, {
    shared: fake({ description: "project" }),
    only: fake(),
  });
  const user = (await env.catalog.load()).active[0];
  env.trust.decide({
    projectId: null,
    resourceKey: "shared",
    contentDigest: user.digest,
    status: "trusted",
  });
  const port = env.hub.port(env.run(undefined, project));
  const rows = (await port.listServers()).map((server) => [
    server.name,
    server.scope,
    server.state,
    server.description,
  ]);
  assert.deepEqual(rows, [
    ["shared", "user", "idle", "user"],
    ["only", "project", "needs_approval", undefined],
    ["shared", "project", "needs_approval", "project"],
  ]);
  await env.approveAll(project);
  assert.deepEqual(
    (await port.listServers()).map((server) => [
      server.name,
      server.scope,
      server.description,
    ]),
    [
      ["shared", "project", "project"],
      ["only", "project", undefined],
    ],
  );
  // The same entry copied to the user file would not be approved: the digest covers the scope.
  assert.notEqual(
    (await env.catalog.load(project)).active[0].digest,
    user.digest,
  );
});

void test("secrets are scoped: a project entry reads its project's secrets, never the user's", async () => {
  await using env = await setup({
    mine: fake({ env: { FAKE_MCP_TOKEN: "${secret:token}" } }),
  });
  const project = {
    projectId: "proj_1",
    projectDirectory: join(env.home, "p"),
  };
  await writeProject(project.projectDirectory, {
    theirs: fake({ env: { FAKE_MCP_TOKEN: "${secret:token}" } }),
  });
  await env.approveAll(project);
  env.vault.values.set("mcp:user:token", "user-token");
  const port = env.hub.port(env.run(undefined, project));
  const text = async (server: string) =>
    (
      (await port.callTool(server, "whereami", {})).content[0] as {
        text: string;
      }
    ).text;
  assert.equal(JSON.parse(await text("mine")).token, "user-token");
  await assert.rejects(port.callTool("theirs", "whereami", {}), {
    code: "SERVER_ERROR",
    message:
      /secret token is not set; the user adds it in Project settings → Agent → MCP servers/,
  });
  env.vault.values.set("mcp:project:proj_1:token", "project-token");
  assert.equal(JSON.parse(await text("theirs")).token, "project-token");
});

void test("the tool index answers without starting, follows the entry and refreshes on list_changed", async () => {
  await using env = await setup({});
  const log = join(env.home, "starts");
  const entry = (extra: Record<string, string> = {}) =>
    fake({
      env: { FAKE_MCP_GROW: "1", FAKE_MCP_START_LOG: log, ...extra },
    });
  const starts = async () =>
    (await readFile(log, "utf8").catch(() => "")).length;
  await writeUser(env.home, { fake: entry() });
  await env.approveAll();
  const port = env.hub.port(env.run());
  const names = async () => (await port.listTools("fake")).map((t) => t.name);
  assert.ok((await names()).includes("grow"));
  assert.equal(await starts(), 1);
  const [approved] = (await env.catalog.load()).active;
  assert.equal(await env.hub.disconnect(approved, env.home), true);
  // Served from the index: the program is not started again.
  assert.ok((await names()).includes("grow"));
  assert.equal(await starts(), 1);
  assert.equal((await env.hub.status(approved, env.home)).toolCount, 7);
  // A tool the server adds shows up after its list_changed notification.
  await port.callTool("fake", "grow", {});
  assert.equal(await starts(), 2);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok((await names()).includes("extra"));
  assert.equal((await env.hub.status(approved, env.home)).toolCount, 8);
  // A changed entry has its own index: it starts again and does not see the old one.
  await writeUser(env.home, { fake: entry({ EXTRA: "1" }) });
  await env.approveAll();
  const [changed] = (await env.catalog.load()).active;
  assert.equal((await env.hub.status(changed, env.home)).toolCount, undefined);
  assert.ok((await names()).includes("grow"));
  assert.equal(await starts(), 3);
});

void test("reconcile closes connections of entries that changed or lost approval", async () => {
  await using env = await setup({ fake: fake() });
  await env.approveAll();
  const port = env.hub.port(env.run());
  await port.callTool("fake", "echo", { text: "a" });
  assert.equal((await port.listServers())[0].state, "connected");
  await writeUser(env.home, { fake: fake({ description: "edited" }) });
  await env.hub.reconcile();
  const [entry] = (await env.catalog.load()).active;
  assert.equal(entry.review, "needs_approval");
  assert.equal((await env.hub.status(entry, env.home)).state, "idle");
});

void test("mcpBlock puts disabled before approval", () => {
  const entry = {
    name: "x",
    scope: "user",
    server: { name: "x", kind: "stdio", config: { command: "c" } },
    digest: "sha256:0",
    review: "needs_approval",
  } as const;
  assert.equal(mcpBlock(entry, { x: false }), "disabled");
  assert.equal(mcpBlock(entry, undefined), "needs_approval");
  assert.equal(mcpBlock(entry, { x: true }), "needs_approval");
});
