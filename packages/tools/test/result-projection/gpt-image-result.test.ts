import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ValidatedToolArtifact } from "@nervekit/contracts/tools";
import {
  agentResultPolicyForTool,
  projectAgentResult,
} from "../../src/result-projection/index.js";

const generatedImage: ValidatedToolArtifact = {
  version: 1,
  id: "generated-image",
  role: "primary_result",
  access: {
    kind: "agent_file",
    path: "/tmp/tool-call/files/generated-1.png",
  },
  availability: "available",
  format: { kind: "image", mediaType: "image/png" },
  size: { bytes: 2048 },
  recommendedTools: ["read"],
  label: "Generated image 1",
};

describe("GPT Image agent result", () => {
  it("provides only the validated generated-file path", () => {
    const projected = projectAgentResult(
      {
        toolName: "gpt_image",
        args: { prompt: "A coral nerve cell" },
        result: {
          contentBlocks: [
            {
              type: "text",
              text: "Generated 1 image with gpt-image-2.5-flare.",
            },
          ],
        },
        status: "completed",
        phase: "completed",
        validatedArtifacts: [generatedImage],
      },
      agentResultPolicyForTool("gpt_image"),
    );
    const text = projected.blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    assert.equal(text, "/tmp/tool-call/files/generated-1.png");
    assert.deepEqual(projected.blocks, [
      { type: "text", text: "/tmp/tool-call/files/generated-1.png" },
    ]);
  });
});
