import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { explainImageWithModel } from "../../src/models/image/explanation.js";
import { registerManagedFauxProvider } from "../../src/models/model-registry.js";

describe("explainImageWithModel", () => {
  it("streams thinking and text separately and returns only final text", async () => {
    const registration = registerManagedFauxProvider({
      provider: "nerve-faux-image-explanation",
      models: [{ id: "vision", name: "Vision" }],
      tokensPerSecond: 10_000,
      tokenSize: { min: 2, max: 4 },
    });
    registration.setResponses([
      async () =>
        fauxAssistantMessage([
          { type: "thinking", thinking: "Inspecting image details." },
          { type: "text", text: "## Result\n\nA settings screen." },
        ]),
    ]);
    const model = {
      ...registration.getModel("vision"),
      input: ["text", "image"] as const,
      reasoning: true,
    };
    const updates: Array<{ kind: "thinking" | "text"; delta: string }> = [];
    try {
      const explanation = await explainImageWithModel({
        model,
        image: {
          type: "image",
          data: "iVBORw0KGgo=",
          mimeType: "image/png",
        },
        thinkingLevel: "high",
        onDelta: (update) => updates.push(update),
      });
      assert.equal(explanation, "## Result\n\nA settings screen.");
      assert.equal(
        updates
          .filter((update) => update.kind === "thinking")
          .map((update) => update.delta)
          .join(""),
        "Inspecting image details.",
      );
      assert.equal(
        updates
          .filter((update) => update.kind === "text")
          .map((update) => update.delta)
          .join(""),
        "## Result\n\nA settings screen.",
      );
    } finally {
      registration.unregister();
    }
  });

  it("does not fail inference when live progress reporting throws", async () => {
    const registration = registerManagedFauxProvider({
      provider: "nerve-faux-image-progress-failure",
      models: [{ id: "vision", name: "Vision" }],
      tokensPerSecond: 10_000,
    });
    registration.setResponses([
      async () => fauxAssistantMessage("A complete explanation."),
    ]);
    try {
      const explanation = await explainImageWithModel({
        model: {
          ...registration.getModel("vision"),
          input: ["text", "image"] as const,
        },
        image: {
          type: "image",
          data: "iVBORw0KGgo=",
          mimeType: "image/png",
        },
        onDelta: () => {
          throw new Error("subscriber unavailable");
        },
      });
      assert.equal(explanation, "A complete explanation.");
    } finally {
      registration.unregister();
    }
  });
});
