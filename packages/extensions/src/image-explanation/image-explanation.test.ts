import assert from "node:assert/strict";
import { test } from "node:test";
import type { VisionRequest } from "@nervekit/extension-api";
import { createFakeContext } from "@nervekit/extension-api/testing";
import { EXPLAIN_IMAGE_MAX_BYTES, explainImageTool } from "./explain-image.js";
import { imageExplanationExtension } from "./manifest.js";

const tool = explainImageTool;

function setup(options: { ready?: boolean; bytes?: number } = {}) {
  const requests: VisionRequest[] = [];
  const fake = createFakeContext({
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
  fake.record.artifacts.set("artifact:shot.png", {
    bytes: new Uint8Array(options.bytes ?? 4),
    mediaType: "image/png",
    name: "shot.png",
  });
  return { ...fake, requests };
}

void test("the extension is off by default and asks for a vision model", () => {
  assert.equal(imageExplanationExtension.enabledByDefault, false);
  assert.deepEqual(imageExplanationExtension.permissions?.capabilities, [
    "models.vision",
  ]);
  assert.deepEqual(imageExplanationExtension.settings.fields.model, {
    type: "model",
    capability: "vision",
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
  assert.equal(requests[0].prompt, "colors");
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

void test("explain_image refuses images over the limit before reading them", async () => {
  const { ctx, requests } = setup({ bytes: EXPLAIN_IMAGE_MAX_BYTES + 1 });
  await assert.rejects(
    tool.run({ path: "artifact:shot.png" }, ctx),
    /too large for explain_image/,
  );
  assert.equal(requests.length, 0);
});

void test("without a usable model the tool is unavailable and a call says how to fix it", async () => {
  const { ctx } = setup({ ready: false });
  assert.deepEqual(await tool.availability(ctx), {
    available: false,
    reason: "No usable image-capable model is selected.",
    fix: "Ask the user to choose an image-capable model in Settings → Extensions → Image explanation.",
  });
  await assert.rejects(
    tool.run({ path: "artifact:shot.png" }, ctx),
    (error) => {
      assert.equal((error as { code?: string }).code, "DENIED");
      return true;
    },
  );
});
