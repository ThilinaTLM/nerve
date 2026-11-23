import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { McpServerHub } from "./mcp-server-hub.js";

const FAKE_SERVER = fileURLToPath(
  new URL("../../../test/fixtures/mcp/fake-mcp-server.mjs", import.meta.url),
);

async function setup(servers: Record<string, unknown>) {
  const home = await mkdtemp(join(tmpdir(), "nerve-mcp-"));
  await mkdir(join(home, "config"));
  await writeFile(
    join(home, "config", "mcp.json"),
    JSON.stringify({ mcpServers: servers }),
  );
  const hub = new McpServerHub({ home, version: "0.0.0-test" });
  return {
    hub,
    home,
    async [Symbol.asyncDispose]() {
      await hub.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}

const fake = (extra: Record<string, unknown> = {}) => ({
  command: process.execPath,
  args: [FAKE_SERVER],
  ...extra,
});

void test("starts a stdio server on first use, lists and calls its tools, and reuses the connection", async () => {
  await using env = await setup({
    fake: fake({ description: "Fake", env: { FAKE_MCP_TOKEN: "${HOME}" } }),
    off: fake({ enabled: false }),
  });
  const port = env.hub.port(env.home);
  assert.deepEqual(
    (await port.listServers()).map((server) => [server.name, server.state]),
    [
      ["fake", "idle"],
      ["off", "disabled"],
    ],
  );
  const tools = await port.listTools("fake");
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["echo", "add", "pixel", "fail", "whereami"],
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

void test("unknown, disabled and failing servers fail with the reason", async () => {
  await using env = await setup({
    fake: fake(),
    off: fake({ enabled: false }),
    broken: { command: process.execPath, args: ["-e", "process.exit(3)"] },
  });
  const port = env.hub.port(env.home);
  await assert.rejects(port.listTools("nope"), {
    code: "NOT_FOUND",
    message: /No MCP server "nope"\. Configured: fake, off, broken\./,
  });
  await assert.rejects(port.listTools("off"), {
    code: "NOT_FOUND",
    message: /disabled/,
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
    code: "SERVER_ERROR",
    message: /Unknown tool: nope.*inputSchema/,
  });
});
