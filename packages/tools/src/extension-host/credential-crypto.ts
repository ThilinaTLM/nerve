import {
  createHash,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
  constants,
  type KeyObject,
} from "node:crypto";
import { ExtensionError } from "@nervekit/extension-api";

/** What a credential provider's `ctx.crypto` may ask of the host. */
export const HASH_ALGORITHMS = [
  "sha256",
  "sha384",
  "sha512",
  "sha1",
  "md5",
] as const;
export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];

const SIGN_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
] as const;
export type SignAlgorithm = (typeof SIGN_ALGORITHMS)[number];

/** Largest input of `hash` and `hmac`; a request body is digested by the host, not passed in. */
const MAX_HASH_BYTES = 16 * 1024 * 1024;
const MAX_SIGN_BYTES = 1024 * 1024;
const MAX_KEY_BYTES = 16 * 1024;
const MAX_RANDOM_BYTES = 1024;

const bad = (message: string) => new ExtensionError("BAD_REQUEST", message);

function bytes(value: unknown, what: string, limit: number): Buffer {
  const buffer =
    typeof value === "string"
      ? Buffer.from(value, "utf8")
      : value instanceof Uint8Array
        ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        : undefined;
  if (!buffer) throw bad(`${what} must be a string or bytes.`);
  if (buffer.byteLength > limit)
    throw bad(`${what} is larger than ${limit} bytes.`);
  return buffer;
}

export function hashAlgorithm(value: unknown): HashAlgorithm {
  if (!(HASH_ALGORITHMS as readonly unknown[]).includes(value))
    throw bad(`Unsupported hash algorithm. Use ${HASH_ALGORITHMS.join(", ")}.`);
  return value as HashAlgorithm;
}

const CURVE: Record<string, string> = {
  ES256: "prime256v1",
  ES384: "secp384r1",
  ES512: "secp521r1",
};

/** The key a signature algorithm needs, checked against its PEM. */
function privateKeyFor(algorithm: SignAlgorithm, pem: unknown): KeyObject {
  if (typeof pem !== "string" || pem.length > MAX_KEY_BYTES)
    throw bad("privateKey must be a PEM string.");
  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw bad("privateKey is not a valid PEM private key.");
  }
  const type = key.asymmetricKeyType;
  const expected = algorithm.startsWith("ES")
    ? "ec"
    : algorithm === "EdDSA"
      ? "ed25519"
      : "rsa";
  if (algorithm === "PS256" && type !== "rsa" && type !== "rsa-pss")
    throw bad("PS256 needs an RSA key.");
  else if (algorithm !== "PS256" && type !== expected)
    throw bad(`${algorithm} needs a ${expected.toUpperCase()} key.`);
  if (
    algorithm.startsWith("ES") &&
    key.asymmetricKeyDetails?.namedCurve !== CURVE[algorithm]
  )
    throw bad(`${algorithm} needs a ${CURVE[algorithm]} key.`);
  return key;
}

/** The host side of `ctx.crypto`: hash, HMAC, random bytes and JWS-style signatures. */
export const hostCrypto = {
  hash(algorithm: unknown, data: unknown): Uint8Array {
    return new Uint8Array(
      createHash(hashAlgorithm(algorithm))
        .update(bytes(data, "data", MAX_HASH_BYTES))
        .digest(),
    );
  },
  hmac(algorithm: unknown, key: unknown, data: unknown): Uint8Array {
    return new Uint8Array(
      createHmac(hashAlgorithm(algorithm), bytes(key, "key", MAX_KEY_BYTES))
        .update(bytes(data, "data", MAX_HASH_BYTES))
        .digest(),
    );
  },
  randomBytes(length: unknown): Uint8Array {
    if (
      typeof length !== "number" ||
      !Number.isInteger(length) ||
      length < 1 ||
      length > MAX_RANDOM_BYTES
    )
      throw bad(`length must be an integer from 1 to ${MAX_RANDOM_BYTES}.`);
    return new Uint8Array(randomBytes(length));
  },
  sign(input: unknown): Uint8Array {
    const { algorithm, privateKey, data } = (input ?? {}) as Record<
      string,
      unknown
    >;
    if (!(SIGN_ALGORITHMS as readonly unknown[]).includes(algorithm))
      throw bad(
        `Unsupported signature algorithm. Use ${SIGN_ALGORITHMS.join(", ")}.`,
      );
    const name = algorithm as SignAlgorithm;
    const key = privateKeyFor(name, privateKey);
    const message = bytes(data, "data", MAX_SIGN_BYTES);
    const digest = name === "EdDSA" ? null : `sha${name.slice(2)}`;
    const options = name.startsWith("ES")
      ? { key, dsaEncoding: "ieee-p1363" as const }
      : name === "PS256"
        ? {
            key,
            padding: constants.RSA_PKCS1_PSS_PADDING,
            saltLength: 32,
          }
        : key;
    return new Uint8Array(sign(digest, message, options));
  },
};
