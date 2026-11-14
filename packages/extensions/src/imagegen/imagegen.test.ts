import assert from "node:assert/strict";
import { test } from "node:test";
import type { ImageRequest } from "@nervekit/extension-api";
import { createFakeContext } from "@nervekit/extension-api/testing";
import { assertOpenAiCodexSize, resolveRequest } from "./backends.js";
import { imagegenMethods } from "./imagegen-methods.js";
import { imagegenExtension } from "./manifest.js";

const PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function setup(settings: Record<string, string> = {}) {
  const requests: ImageRequest[] = [];
  const fake = createFakeContext({
    settings: { backend: "openai-codex", ...settings },
    image: (request) => {
      requests.push(request);
      return {
        provider: "openai-codex",
        model: request.options.model,
        images: [{ data: PIXEL_PNG }],
      };
    },
  });
  return { ...fake, requests };
}

const generate = (
  ctx: ReturnType<typeof setup>["ctx"],
  options: Record<string, unknown>,
) => {
  const input = imagegenMethods.generate.parse([options]);
  return {
    input,
    authorization: imagegenMethods.generate.authorize?.(input),
    run: async () => await imagegenMethods.generate.run(undefined, input, ctx),
  };
};

void test("imagegen.generate applies call options over settings and stores an artifact", async () => {
  const { ctx, record, requests } = setup({
    model: "gpt-image-2.5-sunburst",
    quality: "high",
  });
  const call = generate(ctx, {
    prompt: "  A coral nerve cell  ",
    size: "1536x1024",
    name: "hero",
    backendOptions: { background: "transparent" },
  });
  assert.deepEqual(call.authorization, [
    { targets: [], summary: "A coral nerve cell" },
  ]);
  assert.equal(await call.run(), "artifact:hero.png");
  assert.equal(
    record.artifacts.get("artifact:hero.png")?.mediaType,
    "image/png",
  );
  assert.equal(requests[0]?.prompt, "A coral nerve cell");
  assert.deepEqual(requests[0]?.options, {
    backend: "openai-codex",
    model: "gpt-image-2.5-sunburst",
    quality: "high",
    size: "1536x1024",
    background: "transparent",
  });
});

void test("workspace references are authorized as reads", async () => {
  const { ctx } = setup();
  const call = generate(ctx, {
    prompt: "x",
    inputs: ["artifact:a.png", "ref.png"],
  });
  assert.deepEqual(call.authorization, [
    { targets: [], summary: "x" },
    { toolName: "read", args: { path: "ref.png" }, summary: "ref.png" },
  ]);
});

void test("bad options fail before any call is authorized and spend nothing", async () => {
  const { ctx, requests } = setup();
  for (const [options, message] of [
    [{ prompt: "x", size: "100x100" }, /multiples of 16/],
    [
      { prompt: "x", backendOptions: { style: "vivid" } },
      /valid: quality, background/,
    ],
    [
      { prompt: "x", backendOptions: { quality: "ultra" } },
      /backendOptions\.quality must be one of/,
    ],
    [{ prompt: "" }, /prompt/],
    [{ prompt: "x", prompt2: "y" }, /no option 'prompt2'/],
  ] as const)
    assert.throws(
      () => generate(ctx, options),
      message,
      JSON.stringify(options),
    );
  // Reference images are a settings-dependent refusal: caught before the backend is called.
  await assert.rejects(
    generate(ctx, { prompt: "x", inputs: ["a.png"] }).run(),
    /cannot take reference images/,
  );
  assert.equal(requests.length, 0);
});

void test("size rules match the openai-codex backend", () => {
  assert.equal(assertOpenAiCodexSize("auto"), "auto");
  assert.equal(assertOpenAiCodexSize("1536x1024"), "1536x1024");
  for (const size of ["1000x1000", "4096x1024", "3840x1024", "640x480", "x"])
    assert.throws(() => assertOpenAiCodexSize(size), /size must be/, size);
  assert.throws(
    () =>
      resolveRequest(
        {
          backend: "openai-codex",
          model: "m",
          quality: "auto",
          size: "auto",
          background: "auto",
        },
        { inputs: 0 },
      ),
    /model must be one of/,
  );
});

void test("the namespace describes the configured backend and its options", () => {
  const { ctx } = setup({ quality: "low" });
  assert.match(
    imagegenExtension.namespaces[0].configuration?.(ctx) ?? "",
    /Configured backend: openai-codex, model gpt-image-2\.5-flare, defaults quality low, size auto/,
  );
});
