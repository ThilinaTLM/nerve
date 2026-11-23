import assert from "node:assert/strict";
import test from "node:test";
import { parseMcpConfig, resolveMcpServer } from "./mcp-config.js";

void test("valid entries load; invalid ones are reported and left out", () => {
  const file = parseMcpConfig(
    "/home/config/mcp.json",
    JSON.stringify({
      mcpServers: {
        fs: { command: "npx", args: ["-y", "server-filesystem", "."] },
        docs: { url: "https://example.com/mcp", headers: { A: "b" } },
        broken: { args: [] },
        signin: { url: "https://example.com/mcp", oauth: {} },
        "bad name": { command: "x" },
      },
    }),
  );
  assert.deepEqual(
    file.servers.map((server) => [server.name, server.kind]),
    [
      ["fs", "stdio"],
      ["docs", "http"],
    ],
  );
  assert.equal(file.problems.length, 3);
  assert.match(file.problems.join("\n"), /"broken" needs either "command"/);
  assert.match(file.problems.join("\n"), /"signin".*OAuth sign-in/);
});

void test("a file that is not JSON or has unknown top-level fields is reported", () => {
  assert.match(parseMcpConfig("p", "{").problems[0], /not valid JSON/);
  assert.match(
    parseMcpConfig("p", JSON.stringify({ servers: {} })).problems[0],
    /unknown field "servers"/,
  );
});

void test("variables are expanded and a relative cwd resolves against the project", () => {
  const [entry] = parseMcpConfig(
    "p",
    JSON.stringify({
      mcpServers: {
        gh: {
          command: "run-${TOOL}",
          args: ["--token", "${TOKEN}", "${MISSING:-fallback}"],
          env: { KEY: "${TOKEN}" },
          cwd: "sub",
        },
      },
    }),
  ).servers;
  assert.deepEqual(
    resolveMcpServer(entry, "/project", { TOOL: "gh", TOKEN: "t" }),
    {
      kind: "stdio",
      command: "run-gh",
      args: ["--token", "t", "fallback"],
      env: { KEY: "t" },
      cwd: "/project/sub",
    },
  );
  assert.throws(
    () => resolveMcpServer(entry, "/project", { TOOL: "gh" }),
    /TOKEN is not set/,
  );
});
