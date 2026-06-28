import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { AUDIO_TRANSCRIPTION_MAX_DURATION_MS } from "@nervekit/shared";
import { createOrchestratorState } from "../src/app/orchestrator-state.js";
import { createApp } from "../src/app/server.js";
import {
  chatGptAccountIdFromAccessToken,
  normalizeAudioMimeType,
} from "../src/domains/transcription/transcription.service.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempHome(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function createAuthenticatedApp() {
  const storage = await initializeStorage(
    await tempHome("nerve-audio-transcription-"),
  );
  const state = createOrchestratorState(storage, "127.0.0.1", 0);
  await state.registry.hydrate();
  const app = createApp(state);
  const headers = { authorization: `Bearer ${storage.localToken}` };
  return { app, state, headers };
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

function audioForm(type = "audio/webm", durationMs = 1234): FormData {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array([1, 2, 3])], { type }),
    "audio.webm",
  );
  form.append("durationMs", String(durationMs));
  return form;
}

describe("audio transcription", () => {
  it("normalizes browser audio MIME types", () => {
    assert.deepEqual(normalizeAudioMimeType("audio/webm;codecs=opus"), {
      mimeType: "audio/webm",
      extension: "webm",
    });
    assert.deepEqual(normalizeAudioMimeType("audio/x-wav"), {
      mimeType: "audio/wav",
      extension: "wav",
    });
    assert.deepEqual(normalizeAudioMimeType("audio/wav; codecs=1"), {
      mimeType: "audio/wav",
      extension: "wav",
    });
    assert.deepEqual(normalizeAudioMimeType("audio/mpga"), {
      mimeType: "audio/mpga",
      extension: "mpga",
    });
    assert.deepEqual(normalizeAudioMimeType("audio/ogg;codecs=opus"), {
      mimeType: "audio/ogg",
      extension: "ogg",
    });
    assert.deepEqual(normalizeAudioMimeType("audio/m4a"), {
      mimeType: "audio/mp4",
      extension: "mp4",
    });
    assert.equal(normalizeAudioMimeType("text/plain"), undefined);
  });

  it("extracts the ChatGPT account id from an OpenAI access token", () => {
    const jwt = makeJwt({
      "https://api.openai.com/auth": { chatgpt_account_id: "acc-test" },
    });
    assert.equal(chatGptAccountIdFromAccessToken(jwt), "acc-test");
    assert.equal(chatGptAccountIdFromAccessToken("not-a-jwt"), undefined);
  });

  it("rejects missing audio uploads", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const response = await app.request("/api/transcription/audio", {
        method: "POST",
        headers,
        body: new FormData(),
      });
      assert.equal(response.status, 400);
      assert.equal(
        ((await response.json()) as { error: { code: string } }).error.code,
        "AUDIO_FILE_REQUIRED",
      );
    } finally {
      state.index.close();
    }
  });

  it("rejects unsupported audio MIME types before auth lookup", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const response = await app.request("/api/transcription/audio", {
        method: "POST",
        headers,
        body: audioForm("text/plain"),
      });
      assert.equal(response.status, 400);
      assert.equal(
        ((await response.json()) as { error: { code: string } }).error.code,
        "UNSUPPORTED_AUDIO_TYPE",
      );
    } finally {
      state.index.close();
    }
  });

  it("requires configured OpenAI Codex OAuth credentials", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    try {
      const response = await app.request("/api/transcription/audio", {
        method: "POST",
        headers,
        body: audioForm(),
      });
      assert.equal(response.status, 401);
      assert.equal(
        ((await response.json()) as { error: { code: string } }).error.code,
        "CHATGPT_SUBSCRIPTION_AUTH_REQUIRED",
      );
    } finally {
      state.index.close();
    }
  });

  it("rejects audio longer than the 8-minute transcription cap", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    const originalFetch = globalThis.fetch;
    try {
      const access = makeJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-capture" },
      });
      await state.auth.setOAuth("openai-codex", {
        access,
        refresh: "refresh-token",
        expires: Date.now() + 60_000,
      });

      let fetchCalled = false;
      globalThis.fetch = (async () => {
        fetchCalled = true;
        return Response.json({ text: "should not run" });
      }) as typeof fetch;

      const response = await app.request("/api/transcription/audio", {
        method: "POST",
        headers,
        body: audioForm("audio/webm", AUDIO_TRANSCRIPTION_MAX_DURATION_MS + 1),
      });
      assert.equal(response.status, 413);
      assert.equal(fetchCalled, false);
      assert.equal(
        ((await response.json()) as { error: { code: string } }).error.code,
        "AUDIO_DURATION_TOO_LONG",
      );
    } finally {
      globalThis.fetch = originalFetch;
      state.index.close();
    }
  });

  it("accepts audio exactly at the 8-minute transcription cap", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    const originalFetch = globalThis.fetch;
    try {
      const access = makeJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-capture" },
      });
      await state.auth.setOAuth("openai-codex", {
        access,
        refresh: "refresh-token",
        expires: Date.now() + 60_000,
      });

      let capturedForm: FormData | undefined;
      globalThis.fetch = (async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        capturedForm = init?.body as FormData;
        return Response.json({ text: "max transcript" });
      }) as typeof fetch;

      const response = await app.request("/api/transcription/audio", {
        method: "POST",
        headers,
        body: audioForm("audio/webm", AUDIO_TRANSCRIPTION_MAX_DURATION_MS),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { text: "max transcript" });
      assert.equal(
        capturedForm?.get("duration_ms"),
        String(AUDIO_TRANSCRIPTION_MAX_DURATION_MS),
      );
    } finally {
      globalThis.fetch = originalFetch;
      state.index.close();
    }
  });

  it("sends WebM audio to the ChatGPT subscription transcription endpoint", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    const originalFetch = globalThis.fetch;
    try {
      const access = makeJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-capture" },
      });
      await state.auth.setOAuth("openai-codex", {
        access,
        refresh: "refresh-token",
        expires: Date.now() + 60_000,
      });

      let capturedUrl = "";
      let capturedHeaders: Headers | undefined;
      let capturedForm: FormData | undefined;
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        capturedUrl = String(input);
        capturedHeaders = new Headers(init?.headers);
        capturedForm = init?.body as FormData;
        return Response.json({ text: "  transcribed text  " });
      }) as typeof fetch;

      const response = await app.request("/api/transcription/audio", {
        method: "POST",
        headers,
        body: audioForm("audio/webm;codecs=opus", 4321),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { text: "transcribed text" });
      assert.equal(capturedUrl, "https://chatgpt.com/backend-api/transcribe");
      assert.equal(capturedHeaders?.get("authorization"), `Bearer ${access}`);
      assert.equal(capturedHeaders?.get("chatgpt-account-id"), "acc-capture");
      assert.equal(capturedHeaders?.get("origin"), "https://chatgpt.com");
      assert.equal(capturedForm?.get("duration_ms"), "4321");
      assert.equal(capturedForm?.get("model"), "gpt-4o-transcribe");
      const file = capturedForm?.get("file");
      assert.ok(file instanceof File);
      assert.equal(file.type, "audio/webm");
      assert.equal(file.name, "whisper.webm");
    } finally {
      globalThis.fetch = originalFetch;
      state.index.close();
    }
  });

  it("forwards WAV uploads with a WAV filename and MIME type", async () => {
    const { app, state, headers } = await createAuthenticatedApp();
    const originalFetch = globalThis.fetch;
    try {
      const access = makeJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-capture" },
      });
      await state.auth.setOAuth("openai-codex", {
        access,
        refresh: "refresh-token",
        expires: Date.now() + 60_000,
      });

      let capturedForm: FormData | undefined;
      globalThis.fetch = (async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        capturedForm = init?.body as FormData;
        return Response.json({ text: "wav transcript" });
      }) as typeof fetch;

      const response = await app.request("/api/transcription/audio", {
        method: "POST",
        headers,
        body: audioForm("audio/wav; codecs=1", 2000),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { text: "wav transcript" });
      const file = capturedForm?.get("file");
      assert.ok(file instanceof File);
      assert.equal(file.type, "audio/wav");
      assert.equal(file.name, "whisper.wav");
    } finally {
      globalThis.fetch = originalFetch;
      state.index.close();
    }
  });
});
