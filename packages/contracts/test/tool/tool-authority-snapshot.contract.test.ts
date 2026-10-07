import assert from "node:assert/strict";
import { test } from "node:test";
import { toolCallRecordSchema } from "../../src/domains/tools/records.js";

const snapshot = {
  version: 1,
  agentId: "agent_owner",
  projectDir: "/source",
  mode: "coding",
  workspaceScope: { roots: ["/source"], readonly: false },
  scopeRestricted: true,
  workspaceRoots: [{ path: "/source", physicalPath: "/physical-source" }],
  managedReadRoot: {
    path: "/home/nerve/data",
    physicalPath: "/home/nerve/data",
  },
  policyRoots: [
    { name: "project", path: "/source", physicalPath: "/physical-source" },
  ],
  cwd: { path: "/source", physicalPath: "/physical-source" },
  targetPaths: [],
};
const record = {
  id: "tool_waiting",
  agentId: "agent_owner",
  conversationId: "conv_shared",
  projectId: "proj_source",
  toolName: "write",
  risk: "workspace_write",
  args: { path: "file", content: "x" },
  cwd: "/source",
  status: "committed",
  phase: "drafted",
  revision: 1,
  attempt: 0,
  interactions: [],
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
  authoritySnapshot: snapshot,
};

test("persisted authority cannot be rebound to another agent or working directory", () => {
  assert.equal(toolCallRecordSchema.safeParse(record).success, true);
  assert.equal(
    toolCallRecordSchema.safeParse({
      ...record,
      authoritySnapshot: { ...snapshot, agentId: "agent_other" },
    }).success,
    false,
  );
  assert.equal(
    toolCallRecordSchema.safeParse({ ...record, cwd: "/new-cwd" }).success,
    false,
  );
  assert.equal(
    toolCallRecordSchema.safeParse({
      ...record,
      authoritySnapshot: { ...snapshot, cwd: undefined },
    }).success,
    false,
  );
  // Historical calls remain readable; dispatch decides whether authority can be reconstructed safely.
  assert.equal(
    toolCallRecordSchema.safeParse({ ...record, authoritySnapshot: undefined })
      .success,
    true,
  );
});

test("full captured configuration requires originating revision/provenance and honest resolved fields", () => {
  const configuration = {
    mode: "coding",
    permissionLevel: "supervised",
    permissionRuleSetId: "supervised",
    thinkingLevel: "off",
    model: { provider: "provider", modelId: "model" },
    projectDir: "/source",
    workspaceScope: snapshot.workspaceScope,
    instructions: "Original",
    systemPrompt: "Composed prompt",
    tools: ["read"],
    skills: [],
  };
  const full = {
    ...snapshot,
    configuration,
    configurationRevision: 4,
    configurationProvenance: "resolved",
  };
  assert.equal(
    toolCallRecordSchema.safeParse({ ...record, authoritySnapshot: full })
      .success,
    true,
  );
  assert.equal(
    toolCallRecordSchema.safeParse({
      ...record,
      authoritySnapshot: { ...full, configurationRevision: undefined },
    }).success,
    false,
  );
  assert.equal(
    toolCallRecordSchema.safeParse({
      ...record,
      authoritySnapshot: { ...full, configurationProvenance: undefined },
    }).success,
    false,
  );
  assert.equal(
    toolCallRecordSchema.safeParse({
      ...record,
      authoritySnapshot: {
        ...full,
        configuration: { ...configuration, model: null },
      },
    }).success,
    false,
  );
  assert.equal(
    toolCallRecordSchema.safeParse({
      ...record,
      authoritySnapshot: {
        ...full,
        configuration: { ...configuration, projectDir: "/replacement" },
      },
    }).success,
    false,
  );
  assert.equal(
    toolCallRecordSchema.safeParse({
      ...record,
      authoritySnapshot: {
        ...full,
        configurationProvenance: "accepted",
        configuration: {
          ...configuration,
          model: null,
          tools: null,
          skills: null,
        },
      },
    }).success,
    true,
  );
});
