import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthManager } from "../../../src/domains/auth/index.js";
import {
  transcriptionRequestFields,
  transcribeAudioWithChatGptSubscription,
} from "../../../src/domains/transcription/transcription.service.js";

describe("transcription request fields", () => {
  it("keeps the existing default request free of optional context", () => {
    assert.deepEqual(
      transcriptionRequestFields({
        model: "gpt-4o-transcribe",
        languages: [],
        vocabulary: [],
      }),
      [["model", "gpt-4o-transcribe"]],
    );
  });

  it("uses structured languages and keywords for gpt-transcribe", () => {
    assert.deepEqual(
      transcriptionRequestFields({
        model: "gpt-transcribe",
        languages: ["en", "fr"],
        vocabulary: ["Nerve", "Codex CLI"],
      }),
      [
        ["model", "gpt-transcribe"],
        ["languages[]", "en"],
        ["languages[]", "fr"],
        ["keywords[]", "Nerve"],
        ["keywords[]", "Codex CLI"],
      ],
    );
  });

  it("converts 4o context into a prompt", () => {
    assert.deepEqual(
      transcriptionRequestFields({
        model: "gpt-4o-mini-transcribe",
        languages: ["en", "de"],
        vocabulary: ["Nerve"],
      }),
      [
        ["model", "gpt-4o-mini-transcribe"],
        [
          "prompt",
          "Expected languages: en, de. Use these exact spellings when spoken: Nerve.",
        ],
      ],
    );
  });
});

const settings = {
  model: "gpt-4o-transcribe" as const,
  languages: [],
  vocabulary: [],
};
const input = {
  data: new Uint8Array([0, 1, 2, 3]),
  mimeType: "audio/wav",
  durationMs: 300,
};

function auth(): AuthManager {
  const claims = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: "account-test" },
    }),
  ).toString("base64url");
  const token = `header.${claims}.signature`;
  return {
    getCredential: async () => ({
      type: "oauth",
      access: token,
      refresh: "test-refresh",
      expires: Date.now() + 60_000,
    }),
    getApiKey: async () => token,
  } as AuthManager;
}

describe("subscription transcription cancellation", () => {
  it("keeps successful uploads unchanged without a signal", async (t) => {
    t.mock.method(globalThis, "fetch", async (url, init) => {
      assert.equal(url, "https://chatgpt.com/backend-api/transcribe");
      assert.equal(init?.method, "POST");
      assert.equal(init?.signal, undefined);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("chatgpt-account-id"), "account-test");
      assert.match(headers.get("Authorization") ?? "", /^Bearer /);
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get("model"), settings.model);
      assert.equal(init.body.get("duration_ms"), "300");
      const file = init.body.get("file");
      assert.ok(file instanceof Blob);
      assert.equal(file.type, "audio/wav");
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), input.data);
      return Response.json({ text: "  Hello  " });
    });
    assert.deepEqual(
      await transcribeAudioWithChatGptSubscription(auth(), input, settings),
      { text: "Hello" },
    );
  });

  it("does not read credentials or dispatch when already aborted", async (t) => {
    const controller = new AbortController();
    controller.abort();
    const authentication = auth();
    const credentialMock = t.mock.method(authentication, "getCredential");
    const keyMock = t.mock.method(authentication, "getApiKey");
    const fetchMock = t.mock.method(globalThis, "fetch", async () => {
      throw new Error("Unexpected upstream request");
    });
    await assert.rejects(
      transcribeAudioWithChatGptSubscription(authentication, input, settings, {
        signal: controller.signal,
      }),
      { name: "AbortError" },
    );
    assert.equal(credentialMock.mock.callCount(), 0);
    assert.equal(keyMock.mock.callCount(), 0);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  for (const stage of ["getCredential", "getApiKey"] as const) {
    it(`avoids dispatch when canceled while awaiting ${stage}`, async (t) => {
      const controller = new AbortController();
      const authentication = auth();
      const original = authentication[stage].bind(authentication);
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started!: () => void;
      const startedPromise = new Promise<void>((resolve) => {
        started = resolve;
      });
      t.mock.method(authentication, stage, async () => {
        started();
        await waiting;
        return original("openai-codex");
      });
      const fetchMock = t.mock.method(globalThis, "fetch", async () => {
        throw new Error("Unexpected upstream request");
      });
      const result = transcribeAudioWithChatGptSubscription(
        authentication,
        input,
        settings,
        { signal: controller.signal },
      );
      await startedPromise;
      controller.abort();
      release();
      await assert.rejects(result, { name: "AbortError" });
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  }

  it("aborts an in-flight upstream fetch without retrying", async (t) => {
    const controller = new AbortController();
    let dispatched!: () => void;
    const dispatch = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    const fetchMock = t.mock.method(globalThis, "fetch", async (_url, init) => {
      assert.equal(init?.signal, controller.signal);
      return new Promise<Response>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason),
          { once: true },
        );
        dispatched();
      });
    });
    const result = transcribeAudioWithChatGptSubscription(
      auth(),
      input,
      settings,
      { signal: controller.signal },
    );
    await dispatch;
    controller.abort();
    await assert.rejects(result, { name: "AbortError" });
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  for (const status of [200, 500]) {
    it(`preserves AbortError while reading a ${status} response body`, async (t) => {
      const controller = new AbortController();
      let reading!: () => void;
      const bodyStarted = new Promise<void>((resolve) => {
        reading = resolve;
      });
      const fetchMock = t.mock.method(
        globalThis,
        "fetch",
        async (_url, init) => {
          assert.equal(init?.signal, controller.signal);
          const response = new Response(null, { status });
          t.mock.method(
            response,
            status === 200 ? "json" : "text",
            async () => {
              return new Promise<never>((_resolve, reject) => {
                controller.signal.addEventListener(
                  "abort",
                  () => reject(controller.signal.reason),
                  { once: true },
                );
                reading();
              });
            },
          );
          return response;
        },
      );
      const result = transcribeAudioWithChatGptSubscription(
        auth(),
        input,
        settings,
        { signal: controller.signal },
      );
      await bodyStarted;
      controller.abort();
      await assert.rejects(result, { name: "AbortError" });
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }
});
