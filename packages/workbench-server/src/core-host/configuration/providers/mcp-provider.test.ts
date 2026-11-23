import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mcpProvider } from "./mcp-provider.js";

void test("mcp.json is reported at user scope: active, or invalid entries as errors", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-mcp-provider-"));
  try {
    const provider = mcpProvider({ home });
    assert.deepEqual(await provider.list({ scope: "user" }), []);
    await mkdir(join(home, "config"));
    const write = (servers: unknown) =>
      writeFile(
        join(home, "config", "mcp.json"),
        JSON.stringify({ mcpServers: servers }),
      );
    await write({ ok: { command: "x" } });
    assert.deepEqual(
      (await provider.list({ scope: "user" })).map((r) => r.state),
      ["active"],
    );
    assert.deepEqual(await provider.check({ scope: "user" }), []);
    assert.deepEqual(await provider.check({ scope: "project" }), []);
    await write({ ok: { command: "x" }, bad: {} });
    const [partial] = await provider.check({ scope: "user" });
    assert.equal(partial.state, "active");
    assert.match(
      partial.diagnostics[0].message,
      /"bad".*the other servers work/,
    );
    await write({ bad: {} });
    const [broken] = await provider.reload({ scope: "user" });
    assert.equal(broken.state, "invalid");
    assert.equal(broken.diagnostics[0].level, "error");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
