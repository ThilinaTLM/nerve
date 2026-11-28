import assert from "node:assert/strict";
import test from "node:test";
import {
  previewSystemPromptParamsSchema,
  previewSystemPromptResultSchema,
} from "@nervekit/contracts/core";
import { resolveAgentConfiguration } from "@nervekit/contracts/agent-configuration";
import { toolManifest } from "@nervekit/tools/catalog";
import { publicSystemPromptPreview } from "./system-prompt-preview.js";

void test("unsent draft preview exposes effective resolution and model-facing tool fields only", () => {
  const draft = previewSystemPromptParamsSchema.parse({
    projectId: "p",
    overrides: {
      model: { provider: "test", modelId: "draft" },
      reasoningLevel: "high",
    },
    config: { instructions: "Unsent instructions" },
  });
  assert.ok("overrides" in draft);
  const resolution = resolveAgentConfiguration({
    role: "lead",
    conversation: draft.overrides,
  });
  const prepared = {
    status: "available" as const,
    systemPrompt: "Unsent instructions",
    resolution,
    tools: toolManifest.filter((tool) => tool.name === "bash"),
  };
  const bash = prepared.tools[0];
  assert.equal(
    previewSystemPromptResultSchema.safeParse(prepared).success,
    false,
  );
  const result = previewSystemPromptResultSchema.parse(
    publicSystemPromptPreview(prepared),
  );
  assert.equal(result.status, "available");
  if (result.status === "available") {
    assert.equal(result.resolution.settings.model?.modelId, "draft");
    assert.equal(
      result.resolution.provenance["/model"]?.source,
      "conversation",
    );
    assert.equal(result.systemPrompt, "Unsent instructions");
    assert.deepEqual(result.tools, [
      {
        name: "bash",
        description: bash.description,
        parameters: JSON.parse(JSON.stringify(bash.parameters)),
      },
    ]);
  }
});
