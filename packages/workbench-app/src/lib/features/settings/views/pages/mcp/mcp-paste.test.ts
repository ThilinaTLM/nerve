import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMcpPaste } from "./mcp-paste";

describe("parseMcpPaste", () => {
  it("reads an mcpServers snippet as READMEs show it", () => {
    const result = parseMcpPaste(
      JSON.stringify({
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_TOKEN: "x", PORT: 80 },
          },
        },
      }),
    );
    assert.deepEqual(result, {
      ok: true,
      ignored: [],
      servers: [
        {
          name: "github",
          entry: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_TOKEN: "x", PORT: "80" },
          },
        },
      ],
    });
  });

  it("reads one entry without a name, and a URL entry as http", () => {
    assert.deepEqual(parseMcpPaste('{"url":"https://x.test/mcp"}'), {
      ok: true,
      ignored: [],
      servers: [{ entry: { url: "https://x.test/mcp", type: "http" } }],
    });
  });

  it("accepts a fragment without the outer braces", () => {
    const result = parseMcpPaste('"pg": { "command": "pg-mcp" }');
    assert.ok(result.ok);
    assert.equal(result.servers[0]?.name, "pg");
  });

  it("reports fields Nerve does not read and keeps every server", () => {
    const result = parseMcpPaste(
      '{"mcpServers":{"a":{"command":"a","oauth":{}},"b":{"url":"https://b.test"}}}',
    );
    assert.ok(result.ok);
    assert.deepEqual(result.ignored, ["oauth"]);
    assert.deepEqual(
      result.servers.map((s) => s.name),
      ["a", "b"],
    );
  });

  it("explains what it cannot read", () => {
    assert.equal(parseMcpPaste("  ").ok, false);
    assert.deepEqual(parseMcpPaste("{nope"), {
      ok: false,
      message: "That is not valid JSON.",
    });
    assert.equal(parseMcpPaste('{"mcpServers":{}}').ok, false);
  });
});
