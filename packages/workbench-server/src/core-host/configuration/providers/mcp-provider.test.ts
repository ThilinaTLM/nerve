import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { McpCatalog } from "../../../domains/mcp/mcp-catalog.js";
import { mcpProvider } from "./mcp-provider.js";

void test("mcp.json is reported per scope: servers waiting for approval, rejected, invalid entries", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-mcp-provider-"));
  try {
    const rows = new Map<
      string,
      { status: "trusted" | "rejected"; contentDigest: string }
    >();
    const catalog = new McpCatalog({
      home,
      trust: {
        find: (_kind, projectId, key) =>
          rows.get(`${projectId}:${key}`) ?? null,
      },
    });
    const provider = mcpProvider({ catalog });
    const user = { scope: "user" as const };
    assert.deepEqual(await provider.list(user), []);
    await mkdir(join(home, "config"));
    const write = (servers: unknown) =>
      writeFile(
        join(home, "config", "mcp.json"),
        JSON.stringify({ mcpServers: servers }),
      );
    await write({ ok: { command: "x" } });
    const [waiting] = await provider.check(user);
    assert.equal(waiting.id, "ok");
    assert.equal(waiting.state, "needs_approval");
    assert.deepEqual(waiting.approval, {
      kind: "consent",
      where: "User settings → Connections → MCP servers",
    });
    const [entry] = (await catalog.load()).active;
    rows.set("null:ok", { status: "trusted", contentDigest: entry.digest });
    assert.deepEqual(await provider.check(user), []);
    assert.deepEqual(
      (await provider.list(user)).map((r) => [r.id, r.state]),
      [["ok", "active"]],
    );
    rows.set("null:ok", { status: "rejected", contentDigest: entry.digest });
    assert.equal((await provider.check(user))[0].state, "disabled");
    await write({ ok: { command: "x" }, bad: {} });
    const partial = (await provider.check(user)).find(
      (r) => r.id === "mcp.json",
    );
    assert.equal(partial?.state, "active");
    assert.match(
      partial.diagnostics[0].message,
      /"bad".*the other servers work/,
    );
    await write({ bad: {} });
    const [broken] = await provider.reload(user);
    assert.equal(broken.state, "invalid");
    assert.equal(broken.diagnostics[0].level, "error");
    // A project's file is reported under the project scope, with its own approval.
    const directory = join(home, "project");
    await mkdir(join(directory, ".nerve", "config"), { recursive: true });
    await writeFile(
      join(directory, ".nerve", "config", "mcp.json"),
      JSON.stringify({
        mcpServers: { linear: { url: "https://example.com/mcp" } },
      }),
    );
    const [pending] = await provider.check({
      scope: "project",
      projectId: "proj_1",
      projectDirectory: directory,
    });
    assert.equal(pending.scope, "project");
    assert.equal(pending.state, "needs_approval");
    assert.equal(
      pending.approval?.where,
      "Project settings → Agent → MCP servers",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
