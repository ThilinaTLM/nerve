import type { CredentialCrypto } from "@nervekit/extension-sdk";

/** Hex of bytes. */
export function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += (byte < 16 ? "0" : "") + byte.toString(16);
  return out;
}

/** SHA-256 of the empty body. */
export const EMPTY_PAYLOAD_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** RFC 3986 percent-encoding, as SigV4 wants it. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export type SigV4Input = {
  method: string;
  /** `host`, `path` and `query` of `ctx.request` (the sandbox has no `URL`). */
  host: string;
  path: string;
  query: [string, string][];
  /** Headers already on the request (`content-type`, ...); the signer adds the rest. */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the body. */
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** Epoch milliseconds; default now. */
  now?: number;
  /** Also send and sign `x-amz-content-sha256` (S3 needs it). */
  contentSha256Header?: boolean;
};

/** `YYYYMMDD'T'HHMMSS'Z'`. */
function amzDate(time: number): string {
  return new Date(time).toISOString().replace(/[-:]|\.\d{3}/g, "");
}

/**
 * The headers that sign a request with AWS Signature Version 4: `Authorization`, `X-Amz-Date`, and
 * when needed `X-Amz-Security-Token` and `X-Amz-Content-Sha256`. `host` is signed but not returned:
 * the host sends it.
 */
export async function sigv4Headers(
  input: SigV4Input,
  crypto: CredentialCrypto,
): Promise<Record<string, string>> {
  const date = amzDate(input.now ?? Date.now());
  const day = date.slice(0, 8);
  const added: Record<string, string> = { "x-amz-date": date };
  if (input.sessionToken) added["x-amz-security-token"] = input.sessionToken;
  if (input.contentSha256Header)
    added["x-amz-content-sha256"] = input.payloadHash;
  const signed: Record<string, string> = {
    host: input.host,
    ...Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([name, value]) => [
        name.toLowerCase(),
        value,
      ]),
    ),
    ...added,
  };
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${signed[name]!.trim().replace(/\s+/g, " ")}\n`)
    .join("");
  // Services other than S3 encode each path segment twice.
  const path =
    input.service === "s3"
      ? input.path
      : input.path
          .split("/")
          .map((segment) => encode(segment))
          .join("/");
  const query = input.query
    .map(([name, value]) => [encode(name), encode(value)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  const canonicalRequest = [
    input.method.toUpperCase(),
    path || "/",
    query,
    canonicalHeaders,
    names.join(";"),
    input.payloadHash,
  ].join("\n");
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    date,
    scope,
    hex(await crypto.hash("sha256", canonicalRequest)),
  ].join("\n");
  let key = await crypto.hmac("sha256", `AWS4${input.secretAccessKey}`, day);
  for (const part of [input.region, input.service, "aws4_request"])
    key = await crypto.hmac("sha256", key, part);
  const signature = hex(await crypto.hmac("sha256", key, stringToSign));
  return {
    ...added,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}
