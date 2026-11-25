import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Nested } from "@nervekit/tools/quick-script/testing";
import { classifyQuickScriptScript } from "@nervekit/tools/quick-script";
import { createTestMcp } from "../fixtures/mcp/test-hub.js";
import { executeQuickScript, registry } from "./registry.js";

const FAKE_SERVER = fileURLToPath(
  new URL("../fixtures/mcp/fake-mcp-server.mjs", import.meta.url),
);

let home: string;
let mcp: Awaited<ReturnType<typeof createTestMcp>>;

before(async () => {
  mcp = await createTestMcp();
  home = mcp.home;
  await mkdir(join(home, "config"), { recursive: true });
  await writeFile(
    join(home, "config", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        fake: { command: process.execPath, args: [FAKE_SERVER] },
      },
    }),
  );
  await mcp.approveAll();
});

after(async () => {
  await mcp[Symbol.asyncDispose]();
});

function run(code: string, authorized: Nested[] = []) {
  return executeQuickScript(
    { code },
    {
      cwd: home,
      conversationDir: join(home, "conversation"),
      mcpAgent: mcp.hub.port(mcp.run()),
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
  const computed = await classifyQuickScriptScript(
    `const text = String(Date.now());
     await mcp.tools.call({ server: "fake", tool: "echo", arguments: { text } });`,
    registry,
  );
  assert.equal(computed.admissible, true);
  assert.deepEqual(computed.calls[0].targets, ["mcp:tool/fake/echo"]);
  const computedTool = await classifyQuickScriptScript(
    `const tool = "echo"; await mcp.tools.call({ server: "fake", tool });`,
    registry,
  );
  assert.deepEqual(computedTool.calls[0].targets, undefined);
  const listing = await classifyQuickScriptScript(
    `await mcp.tools.list("fake");`,
    registry,
  );
  assert.equal(listing.risk, "external_read");
});

void test("a listing without a server checks each server and skips a refused one", async () => {
  const result = await executeQuickScript(
    { code: `return (await mcp.tools.list()).length;` },
    {
      cwd: home,
      conversationDir: join(home, "conversation"),
      mcpAgent: mcp.hub.port(mcp.run()),
      authorizeNested: async (request: Nested) => {
        if (
          "operation" in request &&
          request.targets.includes("mcp:server/fake")
        )
          throw new Error("denied by rule");
      },
    },
  );
  assert.match(result.content, /^0\n/);
  assert.match(result.content, /MCP server "fake" skipped: denied by rule/);
});

function fakePort(
  servers: Array<{
    name: string;
    state: string;
    scope?: string;
    duplicate?: true;
  }>,
  tools: Record<string, string[]>,
  seen: string[] = [],
) {
  return {
    listServers: async () =>
      servers.map((entry) => ({
        ...entry,
        transport: "stdio",
        scope: "user",
        ...entry,
      })),
    listTools: async (server: string) => {
      seen.push(server);
      if (server === "broken") throw new Error("cannot start");
      return (tools[server] ?? []).map((name) => ({
        server,
        name,
        description: `Does ${name}. More.`,
        inputSchema: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" }, note: { type: "string" } },
        },
      }));
    },
  } as unknown as ReturnType<McpServerHub["port"]>;
}

void test("tools.search skips disabled, unreviewed and declined servers with a note and returns compact matches", async () => {
  const seen: string[] = [];
  const result = await executeQuickScript(
    { code: `return await mcp.tools.search("item");` },
    {
      cwd: home,
      conversationDir: join(home, "conversation"),
      mcpAgent: fakePort(
        [
          { name: "a", state: "idle" },
          { name: "broken", state: "failed" },
          { name: "off", state: "disabled" },
          { name: "wait", state: "needs_review" },
          { name: "no", state: "declined" },
        ],
        { a: ["get_item"], off: ["item"], wait: ["item"], no: ["item"] },
        seen,
      ),
      authorizeNested: async () => {},
    },
  );
  assert.deepEqual(seen.sort(), ["a", "broken"]);
  assert.match(
    result.content,
    /a \| get_item \| Does get_item\. \| id: string, note\?: string/,
  );
  assert.match(
    result.content,
    /not used: off \(disabled\), wait \(needs_review\), no \(declined\)/,
  );
  assert.match(result.content, /MCP server "broken" skipped: cannot start/);
});

void test("a pending project row with the name of a working user server is not reported as not used; pages are named", async () => {
  const result = await executeQuickScript(
    { code: `return await mcp.tools.search("item");` },
    {
      cwd: home,
      conversationDir: join(home, "conversation"),
      mcpAgent: fakePort(
        [
          { name: "github", state: "idle" },
          {
            name: "github",
            state: "needs_review",
            scope: "project",
            duplicate: true,
          },
          { name: "other", state: "declined", scope: "project" },
        ],
        { github: ["get_item"] },
      ),
      authorizeNested: async () => {},
    },
  );
  assert.match(result.content, /not used: other \(declined\)\. Only the user/);
  assert.doesNotMatch(result.content, /github \(needs_review\)/);
  assert.match(result.content, /in Settings → MCP servers, project column\./);
});

void test("tools.search cuts at limit with a note naming the total", async () => {
  const names = Array.from({ length: 12 }, (_, i) => `item_${i + 10}`);
  const run = (code: string) =>
    executeQuickScript(
      { code },
      {
        cwd: home,
        conversationDir: join(home, "conversation"),
        mcpAgent: fakePort([{ name: "a", state: "connected" }], { a: names }),
        authorizeNested: async () => {},
      },
    );
  const byDefault = await run(
    `return (await mcp.tools.search("item")).length;`,
  );
  assert.match(byDefault.content, /^10\n/);
  assert.match(byDefault.content, /Showing 10 of 12 matches/);
  const custom = await run(
    `return (await mcp.tools.search({ query: "item", limit: 12 })).length;`,
  );
  assert.match(custom.content, /^12/);
  assert.doesNotMatch(custom.content, /Showing/);
  const tooMany = await run(
    `await mcp.tools.search({ query: "item", limit: 51 });`,
  );
  assert.match(tooMany.content, /limit must be an integer from 1 to 50/);
});
