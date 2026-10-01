import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import { defaultSettings } from "@nervekit/contracts/settings";
import { evaluateRuntimeToolPermission } from "@nervekit/tools/runtime";
import { activeToolNamesForAgent } from "../../../src/domains/tools/orchestration/agent-tool-adapter.js";

it("exposes Kroki only when enabled and permitted, without an auth readiness gate", () => {
  const agent: AgentRecord = {
    id: "agent_kroki",
    conversationId: "conv_kroki",
    projectId: "proj_kroki",
    projectDir: "/tmp/project",
    rootAgentId: "agent_kroki",
    mode: "coding",
    permissionLevel: "autonomous",
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3 },
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  assert.ok(!activeToolNamesForAgent(agent).includes("kroki_export"));
  assert.ok(
    !activeToolNamesForAgent(agent, {
      disabledToolNames: defaultSettings.tools.disabled,
    }).includes("kroki_export"),
  );
  assert.ok(
    activeToolNamesForAgent(agent, { disabledToolNames: [] }).includes(
      "kroki_export",
    ),
  );
  assert.ok(
    !activeToolNamesForAgent(
      { ...agent, permissionLevel: "read_only" },
      { disabledToolNames: [] },
    ).includes("kroki_export"),
  );
  assert.equal(
    evaluateRuntimeToolPermission(
      "kroki_export",
      { diagram_type: "mermaid", source: "graph TD; A-->B" },
      { permissionLevel: "read_only" },
    ).decision,
    "deny",
  );
});
