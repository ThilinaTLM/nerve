import assert from "node:assert/strict";
import { test } from "node:test";
import type { ImageRequest } from "@nervekit/extension-api";
import { createFakeContext } from "@nervekit/extension-api/testing";
import { assertOpenAiCodexSize } from "./backends.js";
import { imagegenMethods } from "./imagegen-methods.js";
import { imagegenExtension } from "./manifest.js";

const PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const MODEL = { provider: "openai-codex", modelId: "gpt-image-2.5-sunburst" };

function setup(settings: Record<string, unknown> = { model: MODEL }) {
  const requests: ImageRequest[] = [];
  const fake = createFakeContext({
    settings,
    image: {
      generate: (request) => {
        requests.push(request);
        return { images: [{ bytes: PIXEL_PNG, mediaType: "image/png" }] };
      },
      ready: settings.model !== undefined,
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

void test("imagegen.generate passes the selected model and call options over settings", async () => {
  const { ctx, record, requests } = setup({ model: MODEL, quality: "high" });
  const call = generate(ctx, {
    prompt: "  A coral nerve cell  ",
    size: "1536x1024",
    name: "hero",
    inputs: ["artifact:ref.png"],
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
  assert.deepEqual(requests[0], {
    model: MODEL,
    prompt: "A coral nerve cell",
    inputs: ["artifact:ref.png"],
    size: "1536x1024",
    quality: "high",
    background: "transparent",
    artifact: { name: "hero" },
  });
});

void test("without a selected model the call is refused and the namespace unavailable", async () => {
  const { ctx, requests } = setup({});
  await assert.rejects(generate(ctx, { prompt: "x" }).run(), /No image model/);
  assert.equal(requests.length, 0);
  const verdict = await imagegenExtension.namespaces[0].availability?.(ctx);
  assert.equal(verdict?.available, false);
});

void test("workspace references are authorized as reads", () => {
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

void test("bad options fail before any call is authorized and spend nothing", () => {
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
  assert.equal(requests.length, 0);
});

void test("size rules match the openai-codex backend", () => {
  assert.equal(assertOpenAiCodexSize("auto"), "auto");
  assert.equal(assertOpenAiCodexSize("1536x1024"), "1536x1024");
  for (const size of ["1000x1000", "4096x1024", "3840x1024", "640x480", "x"])
    assert.throws(() => assertOpenAiCodexSize(size), /size must be/, size);
});

void test("the namespace describes the selected model and its options", () => {
  const { ctx } = setup({ model: MODEL, quality: "low" });
  assert.match(
    imagegenExtension.namespaces[0].configuration?.(ctx) ?? "",
    /Configured model: openai-codex\/gpt-image-2\.5-sunburst, defaults quality low, size auto/,
  );
});

void test("settings v2 fold the backend and model enums into the image model", () => {
  const migrate = imagegenExtension.settings.migrations![2]!;
  assert.deepEqual(
    migrate({
      backend: "openai-codex",
      model: "gpt-image-2.5-sunburst",
      quality: "high",
    }),
    { quality: "high", model: MODEL },
  );
  assert.deepEqual(migrate({ model: "gpt-image-2.5-flare" }), {
    model: { provider: "openai-codex", modelId: "gpt-image-2.5-flare" },
  });
  assert.deepEqual(migrate({ size: "auto" }), { size: "auto" });
});
