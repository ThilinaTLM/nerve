import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createApp, createOrchestratorState } from "../src/server.js";
import { initializeStorage } from "../src/storage.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-server-auth-"));
  roots.push(root);
  return root;
}

describe("server credential route auth", () => {
  it("allows provider metadata via cookie but requires bearer auth for credential mutation", async () => {
    const storage = await initializeStorage(await tempHome());
    const state = createOrchestratorState(storage, "127.0.0.1", 0);
    const app = createApp(state);
    const cookie = `nerve_token=${storage.localToken}`;

    try {
      const metadata = await app.request("/api/auth/providers", {
        headers: { cookie },
      });
      assert.equal(metadata.status, 200);

      const cookieOnlyMutation = await app.request("/api/provider-keys", {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", apiKey: "sk-test" }),
      });
      assert.equal(cookieOnlyMutation.status, 403);
      assert.equal(
        ((await cookieOnlyMutation.json()) as { error: { code: string } }).error
          .code,
        "CLI_AUTH_REQUIRED",
      );
      assert.equal(await state.auth.getApiKey("openai"), undefined);

      const cookieOnlyOAuth = await app.request("/api/auth/oauth/flows", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai-codex" }),
      });
      assert.equal(cookieOnlyOAuth.status, 403);
      assert.equal(
        ((await cookieOnlyOAuth.json()) as { error: { code: string } }).error
          .code,
        "CLI_AUTH_REQUIRED",
      );

      const bearerMutation = await app.request("/api/provider-keys", {
        method: "PUT",
        headers: {
          authorization: `Bearer ${storage.localToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ provider: "openai", apiKey: "sk-test" }),
      });
      assert.equal(bearerMutation.status, 200);
      assert.equal(await state.auth.getApiKey("openai"), "sk-test");
    } finally {
      state.index.close();
    }
  });
});
