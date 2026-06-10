import assert from "node:assert/strict";
import {
  createCipheriv,
  createPublicKey,
  constants as cryptoConstants,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type {
  CredentialKeyResponse,
  EncryptedSecretEnvelope,
} from "@nerve/shared";
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

/** Mirrors the browser `encryptApiKey` hybrid envelope, on the Node side. */
function encryptApiKey(
  apiKey: string,
  key: CredentialKeyResponse,
): EncryptedSecretEnvelope {
  const publicKey = createPublicKey({
    key: Buffer.from(key.publicKey, "base64"),
    format: "der",
    type: "spki",
  });
  const aesKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  // WebCrypto AES-GCM output is ciphertext || authTag.
  const combined = Buffer.concat([ciphertext, cipher.getAuthTag()]);
  const encryptedKey = publicEncrypt(
    {
      key: publicKey,
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    aesKey,
  );
  return {
    keyId: key.keyId,
    encryptedKey: encryptedKey.toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: combined.toString("base64"),
  };
}

describe("server credential route auth", () => {
  it("lets an authenticated UI session manage credentials and rejects anonymous requests", async () => {
    const storage = await initializeStorage(await tempHome());
    const state = createOrchestratorState(storage, "127.0.0.1", 0);
    const app = createApp(state);
    const cookie = `nerve_token=${storage.localToken}`;

    try {
      const metadata = await app.request("/api/auth/providers", {
        headers: { cookie },
      });
      assert.equal(metadata.status, 200);

      // Anonymous requests are rejected by the global API auth middleware.
      const anonymous = await app.request("/api/provider-keys", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", apiKey: "sk-anon" }),
      });
      assert.equal(anonymous.status, 401);
      assert.equal(await state.auth.getApiKey("openai"), undefined);

      // A cookie-authenticated UI session may set a plaintext key.
      const cookieMutation = await app.request("/api/provider-keys", {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", apiKey: "sk-cookie" }),
      });
      assert.equal(cookieMutation.status, 200);
      assert.equal(await state.auth.getApiKey("openai"), "sk-cookie");

      // The credential key endpoint is available to the session.
      const keyResponse = await app.request("/api/auth/credential-key", {
        headers: { cookie },
      });
      assert.equal(keyResponse.status, 200);
      const credentialKey = (await keyResponse.json()) as CredentialKeyResponse;
      assert.equal(credentialKey.algorithm, "RSA-OAEP-256+A256GCM");
      assert.ok(credentialKey.keyId.length > 0);
      assert.ok(credentialKey.publicKey.length > 0);

      // An encrypted envelope round-trips and is decrypted server-side.
      const envelope = encryptApiKey("sk-encrypted", credentialKey);
      const encryptedMutation = await app.request("/api/provider-keys", {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          provider: "anthropic",
          encryptedApiKey: envelope,
        }),
      });
      assert.equal(encryptedMutation.status, 200);
      assert.equal(await state.auth.getApiKey("anthropic"), "sk-encrypted");

      // A stale key id is rejected.
      const staleEnvelope = encryptApiKey("sk-stale", {
        ...credentialKey,
        keyId: "credkey_stale",
      });
      const stale = await app.request("/api/provider-keys", {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          encryptedApiKey: staleEnvelope,
        }),
      });
      assert.equal(stale.status, 400);
      assert.equal(
        ((await stale.json()) as { error: { code: string } }).error.code,
        "CREDENTIAL_KEY_STALE",
      );

      // Bearer auth (the CLI) still works.
      const bearerMutation = await app.request("/api/provider-keys", {
        method: "PUT",
        headers: {
          authorization: `Bearer ${storage.localToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ provider: "groq", apiKey: "sk-bearer" }),
      });
      assert.equal(bearerMutation.status, 200);
      assert.equal(await state.auth.getApiKey("groq"), "sk-bearer");
    } finally {
      state.index.close();
    }
  });
});
