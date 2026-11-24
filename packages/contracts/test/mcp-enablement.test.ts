import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAgentConfiguration } from "../src/domains/agent-configuration/resolver.js";
import type { AppliedProfile } from "../src/domains/agent-configuration/schemas.js";

const servers = (result: ReturnType<typeof resolveAgentConfiguration>) =>
  result.settings.mcpServers?.servers;

test("a server no layer decides is left to its own enabled", () => {
  const result = resolveAgentConfiguration({
    role: "lead",
    eligibleMcpServers: ["github"],
  });
  assert.deepEqual(servers(result) ?? {}, {});
});

test("the highest layer wins per name, and a named entry beats that layer's defaults", () => {
  const result = resolveAgentConfiguration({
    role: "lead",
    eligibleMcpServers: ["github", "linear", "pg"],
    user: { mcpServers: { defaults: true, servers: { github: false } } },
    project: { mcpServers: { servers: { github: true, linear: false } } },
    conversation: { mcpServers: { defaults: false, servers: { pg: true } } },
  });
  assert.deepEqual(servers(result), { github: false, linear: false, pg: true });
  assert.equal(
    result.provenance["/mcpServers/servers/github"]?.source,
    "conversation",
  );
  assert.equal(
    result.provenance["/mcpServers/servers/pg"]?.source,
    "conversation",
  );
});

test("only eligible names are resolved", () => {
  const result = resolveAgentConfiguration({
    role: "lead",
    eligibleMcpServers: ["github"],
    user: { mcpServers: { servers: { github: true, other: true } } },
  });
  assert.deepEqual(servers(result), { github: true });
});

test("a profile requirement beats the conversation layer", () => {
  const profile: AppliedProfile = {
    name: "ops",
    source: "user",
    sourceDigest: "0".repeat(64),
    instructions: "Do ops.",
    recommendations: { mcpServers: { servers: { github: false } } },
    requirements: { mcpServers: { servers: { linear: true } } },
  };
  const result = resolveAgentConfiguration({
    role: "lead",
    eligibleMcpServers: ["github", "linear"],
    appliedProfile: profile,
    conversation: { mcpServers: { servers: { github: true, linear: false } } },
  });
  assert.deepEqual(servers(result), { github: true, linear: true });
  assert.equal(
    result.provenance["/mcpServers/servers/linear"]?.source,
    "requirement",
  );
});
