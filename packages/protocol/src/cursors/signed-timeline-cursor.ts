import type { TimelineViewDescriptor } from "@nervekit/contracts/conversations";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface TimelineCursorPayload {
  version: 1;
  view: TimelineViewDescriptor;
  lastDisplayOrderKey: string;
}

export class SignedTimelineCursorCodec {
  constructor(private readonly secret: Uint8Array) {
    if (secret.byteLength < 32) {
      throw new RangeError(
        "Timeline cursor signing keys must contain 32 bytes.",
      );
    }
  }

  async encode(payload: TimelineCursorPayload): Promise<string> {
    assertPayload(payload);
    const body = base64UrlEncode(encoder.encode(canonicalJson(payload)));
    const signature = base64UrlEncode(await this.sign(body));
    return `${body}.${signature}`;
  }

  async decode(cursor: string): Promise<TimelineCursorPayload | undefined> {
    if (cursor.length > 8_192) return undefined;
    const parts = cursor.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
    const expected = await this.sign(parts[0]);
    const actual = base64UrlDecode(parts[1]);
    if (!actual || !constantTimeEqual(expected, actual)) return undefined;
    try {
      const value: unknown = JSON.parse(
        decoder.decode(base64UrlDecode(parts[0])),
      );
      assertPayload(value);
      return value;
    } catch {
      return undefined;
    }
  }

  private async sign(body: string): Promise<Uint8Array> {
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      Uint8Array.from(this.secret).buffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return new Uint8Array(
      await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(body)),
    );
  }
}

function assertPayload(value: unknown): asserts value is TimelineCursorPayload {
  if (!value || typeof value !== "object")
    throw new TypeError("Invalid cursor.");
  const payload = value as Partial<TimelineCursorPayload>;
  const view = payload.view as Partial<TimelineViewDescriptor> | undefined;
  if (
    payload.version !== 1 ||
    typeof payload.lastDisplayOrderKey !== "string" ||
    !view ||
    typeof view.conversationId !== "string" ||
    typeof view.sourceRevision !== "number" ||
    typeof view.visibilityId !== "string" ||
    typeof view.filterId !== "string" ||
    (view.ordering !== "ancestry_ascending" &&
      view.ordering !== "tree_commit_order") ||
    typeof view.executionIncarnationId !== "string" ||
    !view.projection ||
    typeof view.projection.appliedRevision !== "number" ||
    typeof view.projection.schemaVersion !== "number" ||
    typeof view.projection.policyVersion !== "number" ||
    typeof view.projection.rebuildGeneration !== "number"
  ) {
    throw new TypeError("Invalid timeline cursor payload.");
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array | undefined {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |=
      (left[index % left.byteLength] ?? 0) ^
      (right[index % right.byteLength] ?? 0);
  }
  return difference === 0;
}
