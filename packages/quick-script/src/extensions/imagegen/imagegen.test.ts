import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { image } from "@nervekit/native";
import { executeQuickScript } from "../../runtime/quick-script.js";
import { type Nested } from "../../runtime/test-nested.js";
import type { QuickScriptContext } from "../../runtime/sdk-types.js";
import type { ImageGenerateRequest } from "./backends.js";
import { assertOpenAiCodexSize, resolveRequest } from "./backends.js";

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function setup(settings: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "quick-script-imagegen-"));
  const artifactDir = join(root, "conversation", "quick-script");
  const requests: ImageGenerateRequest[] = [];
  const authorized: Nested[] = [];
  const context: QuickScriptContext = {
    cwd: root,
    conversationDir: join(root, "conversation"),
    imagegen: { backend: "openai-codex", ...settings },
    generateImage: async (request) => {
      requests.push(request);
      return {
        provider: "openai-codex",
        model: request.options.model,
        images: [
          {
            data: (
              await image.transformImage(PIXEL_PNG, {
                resize: { width: 4, height: 4, fit: "fill" },
              })
            ).data,
          },
        ],
      };
    },
    authorizeNested: async (request) => {
      authorized.push(request);
    },
  };
  return {
    artifactDir,
    requests,
    authorized,
    context,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

void test("imagegen.generate authorizes the operation, applies call options over settings and stores an artifact", async (t) => {
  const { artifactDir, requests, authorized, context, cleanup } = await setup({
    model: "gpt-image-2.5-sunburst",
    quality: "high",
  });
  t.after(cleanup);
  const result = await executeQuickScript(
    {
      code: `
        const hero = await imagegen.generate({
          prompt: "  A coral nerve cell  ",
          size: "1536x1024",
          name: "hero",
          backendOptions: { background: "transparent" },
        });
        console.log(hero);
      `,
    },
    context,
  );
  assert.deepEqual(authorized[0], {
    operation: "imagegen.generate",
    targets: [],
    risk: "network",
  });
  assert.equal(result.content?.split("\n")[0], "artifact:hero.png");
  assert.deepEqual(await readdir(artifactDir), ["hero.png"]);
  assert.equal(requests[0]?.prompt, "A coral nerve cell");
  assert.deepEqual(requests[0]?.options, {
    backend: "openai-codex",
    model: "gpt-image-2.5-sunburst",
    quality: "high",
    size: "1536x1024",
    background: "transparent",
  });
});

void test("bad options fail before authorization and spend nothing", async (t) => {
  const { authorized, requests, context, cleanup } = await setup();
  t.after(cleanup);
  for (const [options, message] of [
    ['{ prompt: "x", size: "100x100" }', /multiples of 16/],
    [
      '{ prompt: "x", backendOptions: { style: "vivid" } }',
      /valid: quality, background/,
    ],
    ['{ prompt: "x", inputs: ["a.png"] }', /cannot take reference images/],
    ['{ prompt: "" }', /prompt/],
  ] as const) {
    const result = await executeQuickScript(
      { code: `await imagegen.generate(${options});` },
      context,
    );
    assert.match(result.content ?? "", message, options);
  }
  assert.equal(authorized.length, 0);
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

void test("sdk.describe shows the configured backend and its options", async (t) => {
  const { context, cleanup } = await setup({ quality: "low" });
  t.after(cleanup);
  const result = await executeQuickScript(
    { code: `console.log(await sdk.describe("imagegen"));` },
    {
      ...context,
      namespaces: { imagegen: { configured: true, available: true } },
    },
  );
  assert.match(
    result.content ?? "",
    /Configured backend: openai-codex, model gpt-image-2\.5-flare, defaults quality low, size auto/,
  );
  assert.match(result.content ?? "", /generate\(options: \{ prompt: string/);
});
