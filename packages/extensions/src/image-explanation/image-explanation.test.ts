import assert from "node:assert/strict";
import { test } from "node:test";
import type { VisionRequest } from "@nervekit/extension-api";
import { createFakeContext } from "@nervekit/extension-api/testing";
import { explainImageTool } from "./explain-image.js";
import { imageExplanationExtension } from "./manifest.js";

const tool = explainImageTool;

const MODEL = { provider: "p", modelId: "vision", reasoningLevel: "low" };

function setup(options: { ready?: boolean; model?: unknown } = {}) {
  const requests: VisionRequest[] = [];
  const fake = createFakeContext({
    settings: { model: "model" in options ? options.model : MODEL },
    vision: {
      ready: options.ready ?? true,
      explain: (request, progress) => {
        requests.push(request);
        progress(request.progress!.thinking!, "looking");
        progress(request.progress!.text!, "A red ");
        return { text: " A red square. ", model: "p/m" };
      },
    },
  });
  return { ...fake, requests };
}

void test("the extension is off by default and asks for a vision model; its tool is a read", () => {
  assert.equal(imageExplanationExtension.enabledByDefault, false);
  // Rule sets that allow reads run it without approval.
  assert.equal(tool.risk, "read");
  assert.deepEqual(imageExplanationExtension.permissions?.models, ["vision"]);
  assert.deepEqual(imageExplanationExtension.settings.fields.model, {
    type: "model",
    capability: "vision",
    reasoning: true,
    label: "Model",
    description: "The image-capable model that explains images.",
  });
});

void test("explain_image reads the file as a read and streams thinking and the explanation into live sections", async () => {
  const { ctx, record, requests } = setup();
  const input = tool.parse({ path: "artifact:shot.png", prompt: " colors " });
  assert.deepEqual(input, { path: "artifact:shot.png", prompt: "colors" });
  assert.deepEqual(tool.authorize(input), {
    toolName: "read",
    args: { path: "artifact:shot.png" },
    summary: "artifact:shot.png",
  });
  const output = await tool.run(input, ctx);
  assert.equal(output, "A red square.");
  // The handle goes to the host, which reads it under the declared read; the model is the setting's.
  assert.deepEqual(
    {
      model: requests[0].model,
      image: requests[0].image,
      prompt: requests[0].prompt,
    },
    { model: MODEL, image: "artifact:shot.png", prompt: "colors" },
  );
  assert.deepEqual(record.progress, [
    { section: "thinking", chunk: "looking" },
    { section: "explanation", chunk: "A red " },
  ]);
  assert.deepEqual(tool.present(output), {
    text: "A red square.",
    sections: { explanation: "A red square." },
  });
  const live = tool.view.sections.map((section) => [section.id, section.live]);
  assert.deepEqual(live, [
    ["thinking", "transient"],
    ["explanation", "stream"],
  ]);
});

void test("without a usable model the tool is unavailable and a call says how to fix it", async () => {
  const { ctx } = setup({ ready: false });
  assert.deepEqual(await tool.availability(ctx), {
    available: false,
    reason: "No usable image-capable model is selected.",
    fix: "Ask the user to choose an image-capable model in Settings → Extensions → Image explanation.",
  });
  const { ctx: unset } = setup({ model: undefined });
  await assert.rejects(
    tool.run({ path: "artifact:shot.png" }, unset),
    (error) => {
      assert.equal((error as { code?: string }).code, "DENIED");
      return true;
    },
  );
});

void test("settings v2 folds the old thinkingLevel into the model's reasoningLevel", () => {
  const fold = imageExplanationExtension.settings.migrations![2]!;
  const model = { provider: "p", modelId: "m" };
  assert.equal(imageExplanationExtension.settings.version, 2);
  assert.deepEqual(fold({ model, thinkingLevel: "high" }), {
    model: { ...model, reasoningLevel: "high" },
  });
  assert.deepEqual(fold({ model }), { model });
  // A level without a model at that scope has nothing to attach to.
  assert.deepEqual(fold({ thinkingLevel: "low" }), {});
});
