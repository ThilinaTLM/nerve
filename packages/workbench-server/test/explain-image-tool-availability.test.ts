import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord } from "@nervekit/contracts";
import {
  activeToolNamesForAgent,
  toolPromptMetadata,
} from "../src/domains/tools/agent-tool-adapter.js";

function agent(): AgentRecord {
  return {
    id: "agent_01HN0000000000000000000000",
    conversationId: "conv_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    projectDir: "/tmp/project",
    workerId: "worker_01HN0000000000000000000000",
    rootAgentId: "agent_01HN0000000000000000000000",
    mode: "coding",
    permissionLevel: "autonomous",
    approvalPolicy: { autoApproveReadOnly: true },
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3 },
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function active(options: {
  disabled?: boolean;
  fallbackReady?: boolean;
  primaryVision?: boolean;
}) {
  return activeToolNamesForAgent(agent(), {
    pythonAvailable: true,
    jiraEnabled: true,
    confluenceEnabled: true,
    disabledToolNames: options.disabled ? ["explain_image"] : [],
    imageExplanationAvailable: options.fallbackReady,
    primaryModelSupportsImages: options.primaryVision,
  });
}

describe("explain_image availability", () => {
  it("is exposed only for enabled, configured text-only agents", () => {
    assert.equal(
      active({ fallbackReady: true, primaryVision: false }).includes(
        "explain_image",
      ),
      true,
    );
    assert.equal(
      active({ disabled: true, fallbackReady: true }).includes("explain_image"),
      false,
    );
    assert.equal(
      active({ fallbackReady: false }).includes("explain_image"),
      false,
    );
    assert.equal(
      active({ fallbackReady: true, primaryVision: true }).includes(
        "explain_image",
      ),
      false,
    );
  });

  it("leaves no prompt metadata when disabled", () => {
    const names = active({ disabled: true, fallbackReady: true });
    const metadata = toolPromptMetadata(names);
    assert.equal(names.includes("explain_image"), false);
    assert.equal(metadata.activeToolNames.includes("explain_image"), false);
    assert.equal("explain_image" in metadata.snippets, false);
    assert.equal(JSON.stringify(metadata).includes("explain_image"), false);
  });
});
