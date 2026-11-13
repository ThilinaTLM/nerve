import assert from "node:assert/strict";
import { test } from "node:test";
import { toolSettingsMutation } from "./tool-settings-mutation";
test("clearing a scalar tool setting removes only the local choice, never inherited settings", () => {
  const result = toolSettingsMutation(
    "python_exec",
    { enabled: true, settings: { interpreterPath: undefined } },
    {
      tools: { python_exec: { settings: { interpreterPath: "/old/python" } } },
    },
  );
  assert.deepEqual(result.resets, [
    "/overrides/tools/python_exec/settings/interpreterPath",
  ]);
  assert.deepEqual(
    toolSettingsMutation("python_exec", { settings: {} }, {}).resets,
    [],
  );
});

test("saving editable reasoning excludes Required enabled/model and preserves hidden choices", () => {
  const model = { provider: "openai", modelId: "vision" };
  const result = toolSettingsMutation(
    "explain_image",
    {
      enabled: true,
      settings: { model, thinkingLevel: "high" },
    },
    {
      tools: {
        explain_image: {
          enabled: false,
          settings: { model, thinkingLevel: "low" },
        },
      },
    },
    ["/tools/explain_image/enabled", "/tools/explain_image/settings/model"],
  );
  assert.deepEqual(result, {
    changes: {
      tools: { explain_image: { settings: { thinkingLevel: "high" } } },
    },
    resets: [],
  });
});

test("Required atomic settings are omitted without suppressing editable siblings", () => {
  const result = toolSettingsMutation(
    "bash",
    {
      settings: {
        shellPath: "/bin/zsh",
        maxTimeoutMs: 10000,
        autoPromotion: { enabled: true, afterMs: 1000 },
      },
    },
    {
      tools: {
        bash: {
          settings: {
            autoPromotion: { enabled: false, afterMs: 2000 },
            shellPath: "/bin/sh",
          },
        },
      },
    },
    ["/tools/bash/settings/autoPromotion"],
  );
  assert.deepEqual(result, {
    changes: {
      tools: {
        bash: { settings: { shellPath: "/bin/zsh", maxTimeoutMs: 10000 } },
      },
    },
    resets: [],
  });
  const image = toolSettingsMutation(
    "generate_image",
    {
      enabled: true,
      settings: {
        provider: "openai-codex",
        model: "gpt-image-2.5-flare",
        options: { size: "auto", quality: "auto", background: "auto" },
      },
    },
    {},
    ["/tools/generate_image/settings"],
  );
  assert.deepEqual(image, {
    changes: { tools: { generate_image: { enabled: true } } },
    resets: [],
  });
});

test("clearing Required fields never resets hidden local choices", () => {
  assert.deepEqual(
    toolSettingsMutation(
      "python_exec",
      { enabled: true, settings: { interpreterPath: undefined } },
      {
        tools: {
          python_exec: {
            enabled: false,
            settings: { interpreterPath: "/old/python" },
          },
        },
      },
      ["/tools/python_exec/settings/interpreterPath"],
    ),
    {
      changes: { tools: { python_exec: { enabled: true } } },
      resets: [],
    },
  );
});

test("a fully Required effective payload produces no changes or resets", () => {
  assert.deepEqual(
    toolSettingsMutation(
      "python_exec",
      { enabled: true, settings: { interpreterPath: "/required/python" } },
      {
        tools: {
          python_exec: {
            enabled: false,
            settings: { interpreterPath: "/hidden/python" },
          },
        },
      },
      [
        "/tools/python_exec/enabled",
        "/tools/python_exec/settings/interpreterPath",
      ],
    ),
    { changes: {}, resets: [] },
  );
});
