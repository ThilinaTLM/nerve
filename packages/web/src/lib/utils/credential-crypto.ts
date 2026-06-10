import type { CredentialKeyResponse, EncryptedSecretEnvelope } from "../api";

function base64ToBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

function utf8ToBuffer(value: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(value);
  const buffer = new ArrayBuffer(encoded.length);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}

function bytesToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Encrypts an API key into a hybrid envelope (AES-256-GCM content key wrapped
 * with the orchestrator's RSA-OAEP-SHA256 public key) so the raw key never
 * leaves the browser in plaintext.
 */
export async function encryptApiKey(
  apiKey: string,
  key: CredentialKeyResponse,
): Promise<EncryptedSecretEnvelope> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "Secure cryptography is unavailable. Open the app over HTTPS or on localhost to add credentials.",
    );
  }

  const rsaKey = await subtle.importKey(
    "spki",
    base64ToBuffer(key.publicKey),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );

  const aesKey = await subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );

  const ivBuffer = new ArrayBuffer(12);
  const iv = new Uint8Array(ivBuffer);
  globalThis.crypto.getRandomValues(iv);
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    utf8ToBuffer(apiKey),
  );

  const rawAesKey = await subtle.exportKey("raw", aesKey);
  const encryptedKey = await subtle.encrypt(
    { name: "RSA-OAEP" },
    rsaKey,
    rawAesKey,
  );

  return {
    keyId: key.keyId,
    encryptedKey: bytesToBase64(encryptedKey),
    iv: bytesToBase64(ivBuffer),
    ciphertext: bytesToBase64(ciphertext),
  };
}
