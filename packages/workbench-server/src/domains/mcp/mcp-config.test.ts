import assert from "node:assert/strict";
import test from "node:test";
import {
  mcpEntryDigest,
  mcpGrantSnapshot,
  mcpSendsSentences,
  parseMcpConfig,
  resolveMcpServer,
} from "./mcp-config.js";

const entryOf = (config: unknown) =>
  parseMcpConfig("p", JSON.stringify({ mcpServers: { x: config } })).servers[0];

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
    resolveMcpServer(
      entry,
      "/project",
      { env: { TOOL: "gh", TOKEN: "t" }, secrets: {} },
      "Settings",
    ),
    {
      kind: "stdio",
      command: "run-gh",
      args: ["--token", "t", "fallback"],
      env: { KEY: "t" },
      cwd: "/project/sub",
    },
  );
  assert.throws(
    () =>
      resolveMcpServer(
        entry,
        "/project",
        { env: { TOOL: "gh" }, secrets: {} },
        "Settings",
      ),
    /TOKEN is not set/,
  );
});

void test("secrets expand from the given values and a missing one names the page", () => {
  const entry = entryOf({
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer ${secret:api-key}" },
  });
  assert.deepEqual(
    resolveMcpServer(
      entry,
      "/p",
      { env: {}, secrets: { "api-key": "k" } },
      "Settings",
    ),
    {
      kind: "http",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer k" },
    },
  );
  assert.throws(
    () => resolveMcpServer(entry, "/p", { env: {}, secrets: {} }, "Page X"),
    /secret api-key is not set; the user adds it in Page X/,
  );
});

void test("the digest covers the entry as written and its scope, not variable values", () => {
  const a = entryOf({
    command: "run",
    args: ["${TOKEN}"],
    env: { B: "1", A: "2" },
  });
  const reordered = entryOf({
    env: { A: "2", B: "1" },
    args: ["${TOKEN}"],
    command: "run",
  });
  assert.equal(mcpEntryDigest("user", a), mcpEntryDigest("user", reordered));
  assert.notEqual(mcpEntryDigest("user", a), mcpEntryDigest("project", a));
  assert.notEqual(
    mcpEntryDigest("user", a),
    mcpEntryDigest("user", entryOf({ command: "run", args: ["x"] })),
  );
  assert.match(mcpEntryDigest("user", a), /^sha256:[0-9a-f]{64}$/);
});

void test("the review names what leaves the machine and never a value", () => {
  const grants = mcpGrantSnapshot(
    entryOf({
      url: "https://example.com/mcp",
      headers: {
        Authorization: "Bearer ${secret:key}",
        "X-Org": "${ORG:-none}",
      },
    }),
  );
  assert.deepEqual(mcpSendsSentences(grants), [
    "Sends secret `key` to `https://example.com/mcp` in header `Authorization`.",
    "Sends environment variable `ORG` to `https://example.com/mcp` in header `X-Org`.",
  ]);
  const stdio = mcpGrantSnapshot(
    entryOf({
      command: "npx",
      args: ["-y", "srv"],
      env: { TOKEN: "${TOKEN}" },
      cwd: "sub",
    }),
  );
  assert.equal(stdio.transport, "stdio");
  assert.deepEqual(stdio.args, ["-y", "srv"]);
  assert.equal(stdio.cwd, "sub");
  assert.deepEqual(mcpSendsSentences(stdio), [
    "Passes environment variable `TOKEN` to `npx` in environment variable `TOKEN`.",
  ]);
});
