import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Nested } from "@nervekit/tools/quick-script/testing";
import { classifyQuickScriptScript } from "@nervekit/tools/quick-script";
import { McpServerHub } from "../../src/domains/mcp/mcp-server-hub.js";
import { executeQuickScript, registry } from "./registry.js";

const FAKE_SERVER = fileURLToPath(
  new URL("../fixtures/mcp/fake-mcp-server.mjs", import.meta.url),
);

let home: string;
let hub: McpServerHub;

before(async () => {
  home = await mkdtemp(join(tmpdir(), "nerve-mcp-ns-"));
  await mkdir(join(home, "config"));
  await writeFile(
    join(home, "config", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        fake: { command: process.execPath, args: [FAKE_SERVER] },
      },
    }),
  );
  hub = new McpServerHub({ home, version: "0.0.0-test" });
});

after(async () => {
  await hub.close();
  await rm(home, { recursive: true, force: true });
});

function run(code: string, authorized: Nested[] = []) {
  return executeQuickScript(
    { code },
    {
      cwd: home,
      conversationDir: join(home, "conversation"),
      mcpAgent: hub.port(home),
      authorizeNested: async (request: Nested) => {
        authorized.push(request);
      },
    },
  );
}

void test("a script lists, searches and calls MCP tools; each call is checked per tool", async () => {
  const authorized: Nested[] = [];
  const result = await run(
    `const servers = await mcp.servers.list();
     const [add] = await mcp.tools.search({ query: "add numbers", server: "fake" });
     const sum = await mcp.tools.call({ server: "fake", tool: add.name, arguments: { a: 2, b: 40 } });
     const echo = await mcp.tools.call({ server: "fake", tool: "echo", arguments: { text: "hi" } });
     return { servers: servers.map((s) => s.name), tool: add.name, sum: sum.structured, text: echo.text };`,
    authorized,
  );
  assert.equal(result.exitCode, 0, result.content);
  assert.match(
    result.content,
    /^\{"servers":\["fake"\],"tool":"add","sum":\{"sum":42\},"text":"hi"\}/,
  );
  assert.deepEqual(
    authorized.map((request) => "operation" in request && request.targets),
    [["mcp:server/fake"], ["mcp:tool/fake/add"], ["mcp:tool/fake/echo"]],
  );
});

void test("images become artifacts and a tool error throws SERVER_ERROR", async () => {
  const result = await run(
    `const image = await mcp.tools.call({ server: "fake", tool: "pixel" });
     console.log(image.text, image.files.join());
     try {
       await mcp.tools.call({ server: "fake", tool: "fail" });
     } catch (e) {
       console.log(e.code, e.message);
     }`,
  );
  assert.equal(result.exitCode, 0, result.content);
  assert.match(result.content, /one pixel artifact:mcp-fake-pixel-1\.png/);
  assert.match(
    result.content,
    /SERVER_ERROR MCP tool fake\/fail reported an error: the fake tool failed/,
  );
  await stat(
    join(home, "conversation", "quick-script", "mcp-fake-pixel-1.png"),
  );
});

void test("a script calling an MCP tool is classified destructive and names the tool", async () => {
  const scan = await classifyQuickScriptScript(
    `await mcp.tools.call({ server: "fake", tool: "echo", arguments: { text: "x" } });`,
    registry,
  );
  assert.equal(scan.risk, "destructive");
  assert.equal(scan.admissible, true);
  assert.deepEqual(scan.calls, [
    {
      operation: "mcp.tools.call",
      risk: "destructive",
      targets: ["mcp:tool/fake/echo"],
    },
  ]);
  const listing = await classifyQuickScriptScript(
    `await mcp.tools.list("fake");`,
    registry,
  );
  assert.equal(listing.risk, "external_read");
});
