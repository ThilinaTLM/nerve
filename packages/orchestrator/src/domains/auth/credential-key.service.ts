import {
  createDecipheriv,
  constants as cryptoConstants,
  generateKeyPairSync,
  type KeyObject,
  privateDecrypt,
} from "node:crypto";
import {
  type CredentialKeyResponse,
  createId,
  type EncryptedSecretEnvelope,
} from "@nervekit/shared";
import { HttpError } from "../../http/errors.js";

const GCM_TAG_BYTES = 16;

/**
 * Holds an ephemeral RSA-OAEP keypair (in memory only, regenerated per process)
 * used to receive API keys from the UI with application-layer encryption.
 *
 * The UI encrypts an API key with a hybrid envelope: a random AES-256-GCM key
 * encrypts the secret, and the AES key is wrapped with RSA-OAEP-SHA256. This
 * keeps the raw key out of plaintext request bodies and logs even over plain
 * HTTP. It complements, but does not replace, TLS for remote deployments.
 */
export class CredentialKeyService {
  private readonly keyId = createId("credkey");
  private readonly publicKey: KeyObject;
  private readonly privateKey: KeyObject;

  constructor() {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }

  getPublicKey(): CredentialKeyResponse {
    return {
      keyId: this.keyId,
      algorithm: "RSA-OAEP-256+A256GCM",
      publicKey: this.publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
    };
  }

  decryptEnvelope(envelope: EncryptedSecretEnvelope): string {
    if (envelope.keyId !== this.keyId) {
      throw new HttpError(
        400,
        "CREDENTIAL_KEY_STALE",
        "Credential key is stale. Refetch the public key and retry.",
      );
    }

    let aesKey: Buffer;
    try {
      aesKey = privateDecrypt(
        {
          key: this.privateKey,
          padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        Buffer.from(envelope.encryptedKey, "base64"),
      );
    } catch {
      throw new HttpError(
        400,
        "CREDENTIAL_DECRYPT_FAILED",
        "Could not decrypt the credential envelope.",
      );
    }

    // WebCrypto AES-GCM output is ciphertext || authTag (trailing 16 bytes).
    const combined = Buffer.from(envelope.ciphertext, "base64");
    if (combined.length <= GCM_TAG_BYTES) {
      throw new HttpError(
        400,
        "CREDENTIAL_DECRYPT_FAILED",
        "Could not decrypt the credential envelope.",
      );
    }
    const ciphertext = combined.subarray(0, combined.length - GCM_TAG_BYTES);
    const tag = combined.subarray(combined.length - GCM_TAG_BYTES);

    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        aesKey,
        Buffer.from(envelope.iv, "base64"),
      );
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
      if (!plaintext) {
        throw new Error("Empty credential.");
      }
      return plaintext;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        400,
        "CREDENTIAL_DECRYPT_FAILED",
        "Could not decrypt the credential envelope.",
      );
    }
  }
}
