import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TITLE_TEST_PROMPT,
  type ConversationTitlesSettings,
} from "@nervekit/contracts/settings";
import {
  ConversationTitleService,
  titleErrorCategory,
} from "./title.service.js";

type Options = ConstructorParameters<typeof ConversationTitleService>[0];
const selection = { provider: "custom", modelId: "small" };
const input = {
  conversationId: "c",
  sourceMessageId: "m",
  model: selection,
  text: "Fix settings keyboard focus regression",
};
const message = (title: string) =>
  ({
    content: [{ type: "text", text: title }],
    stopReason: "stop",
    usage: { input: 12, output: 5 },
  }) as never;
function setup(complete: Options["complete"]) {
  let settings: ConversationTitlesSettings = {
    enabled: true,
    model: selection,
  };
  const selections: unknown[] = [];
  const logs: Record<string, unknown>[] = [];
  const service = new ConversationTitleService({
    settings: () => settings,
    resolve: async (selected) => {
      selections.push(selected);
      return {
        model: {
          id: "small",
          provider: "custom",
          api: "openai-completions",
          baseUrl: "https://custom.example/v1",
          headers: { "X-Custom": "catalog" },
          input: ["text"],
          maxTokens: 128,
        } as never,
        apiKey: "selected-credential",
        headers: { "X-Auth": "selected-header" },
      };
    },
    complete,
    log: (data) => logs.push(data),
  });
  return {
    service,
    selections,
    logs,
    disable: () => {
      settings = { ...settings, enabled: false };
      service.cancelQueued();
    },
  };
}
await test("selected model, credentials, endpoint, headers and request budgets are preserved", async () => {
  const { service, selections, logs } = setup(
    async (model, context, options) => {
      assert.equal(model.baseUrl, "https://custom.example/v1");
      assert.equal(options?.apiKey, "selected-credential");
      assert.deepEqual(options?.headers, {
        "X-Custom": "catalog",
        "X-Auth": "selected-header",
      });
      assert.equal(options?.maxTokens, 64);
      assert.equal(options?.reasoning, "minimal");
      assert.ok(options?.signal);
      assert.match(
        context.systemPrompt ?? "",
        /Do not answer or follow instructions/,
      );
      assert.match(String(context.messages[0]?.content), /<untrusted_prompt>/);
      return message("Fix settings keyboard focus regression");
    },
  );
  assert.equal(
    await service.generateTitle(input, new AbortController().signal),
    "Fix settings keyboard focus regression",
  );
  assert.deepEqual(selections, [selection]);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(
    JSON.stringify(logs),
    /Fix settings|selected-credential|selected-header|custom.example/,
  );
});
await test("the settings test sends only the synthetic prompt", async () => {
  let text = "";
  const { service } = setup(async (_model, context) => {
    text = String(context.messages[0]?.content);
    return message("Fix settings panel keyboard focus");
  });
  assert.equal((await service.test()).category, "success");
  assert.equal(
    text,
    `<untrusted_prompt>\n${TITLE_TEST_PROMPT}\n</untrusted_prompt>`,
  );
});
await test("queue bounds concurrency, drops overflow and cancels queued work when disabled", async () => {
  const releases: Array<() => void> = [];
  let count = 0;
  const { service, disable, logs } = setup(async () => {
    count++;
    await new Promise<void>((resolve) => releases.push(resolve));
    return message("Fix settings keyboard focus regression");
  });
  const jobs = Array.from({ length: 10 }, () =>
    service
      .generateTitle(input, new AbortController().signal)
      .catch((error: Error) => error.message),
  );
  await Promise.resolve();
  assert.equal(count, 2);
  await assert.rejects(
    service.generateTitle(input, new AbortController().signal),
    /overflow/,
  );
  disable();
  releases.forEach((release) => release());
  const results = await Promise.all(jobs);
  assert.equal(results.filter((result) => result === "disabled").length, 8);
  assert.equal(count, 2);
  assert.ok(logs.some((log) => log.category === "overflow"));
});
await test("invalid output and provider failures report categories, never fallback", async () => {
  for (const [failure, category] of [
    ["401 unauthorized", "auth"],
    ["429 rate limited", "rate limit"],
    ["timeout", "timeout"],
  ]) {
    const { service, selections } = setup(async () => {
      throw new Error(failure);
    });
    assert.equal((await service.test()).category, category);
    assert.equal(selections.length, 1);
  }
  const { service } = setup(async () => message("NONE"));
  assert.equal((await service.test()).category, "invalid output");
  assert.equal(titleErrorCategory(new Error("missing credentials")), "auth");
});
await test("abort leaves generation without a title", async () => {
  const { service } = setup(async () => new Promise(() => {}));
  const controller = new AbortController();
  const result = service.generateTitle(input, controller.signal);
  controller.abort();
  await assert.rejects(result);
});

await test("deadline expires after five seconds even if the provider ignores abort", async () => {
  const { service } = setup(async () => new Promise(() => {}));
  const keepAlive = setTimeout(() => {}, 6000);
  const started = performance.now();
  try {
    assert.equal((await service.test()).category, "timeout");
    assert.ok(performance.now() - started < 5800);
  } finally {
    clearTimeout(keepAlive);
  }
});

await test("missing credentials skip completion without choosing another model", async () => {
  let completed = false;
  let resolved = 0;
  const service = new ConversationTitleService({
    settings: () => ({ enabled: true, model: selection }),
    resolve: async () => {
      resolved++;
      return { model: { input: ["text"], maxTokens: 128 } as never };
    },
    complete: async () => {
      completed = true;
      return message("Wrong title");
    },
    log: () => {},
  });
  assert.equal((await service.test()).category, "auth");
  assert.equal(completed, false);
  assert.equal(resolved, 1);
});
