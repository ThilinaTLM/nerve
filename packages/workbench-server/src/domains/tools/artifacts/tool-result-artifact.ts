import type { ToolCallRecord } from "@nervekit/contracts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteJson } from "../../../infrastructure/storage-bootstrap/json.js";

const INLINE_RESULT_MAX_BYTES = 4 * 1024;
const MARKER_KEY = "__nerveToolResultArtifact";

type ResultArtifactMarker = {
  version: 1;
  digest: string;
  byteLength: number;
};

export async function externalizeToolCallResult(
  home: string,
  record: ToolCallRecord,
): Promise<ToolCallRecord> {
  if (record.result === undefined || artifactMarker(record.result))
    return record;
  const serialized = JSON.stringify(record.result);
  const byteLength = Buffer.byteLength(serialized);
  if (byteLength <= INLINE_RESULT_MAX_BYTES) return record;
  const digest = createHash("sha256").update(serialized).digest("hex");
  await atomicWriteJson(
    artifactPath(home, record.conversationId, digest),
    record.result,
    0o600,
  );
  return {
    ...record,
    result: {
      content: `Large tool result stored as artifact ${digest}.`,
      [MARKER_KEY]: { version: 1, digest, byteLength },
    },
  };
}

export async function hydrateToolCallResult(
  home: string,
  record: ToolCallRecord,
): Promise<ToolCallRecord> {
  const marker = artifactMarker(record.result);
  if (!marker) return record;
  const result = JSON.parse(
    await readFile(
      artifactPath(home, record.conversationId, marker.digest),
      "utf8",
    ),
  );
  const digest = createHash("sha256")
    .update(JSON.stringify(result))
    .digest("hex");
  if (digest !== marker.digest) {
    throw new Error(
      `Tool result artifact '${marker.digest}' failed verification.`,
    );
  }
  return { ...record, result };
}

function artifactMarker(value: unknown): ResultArtifactMarker | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const marker = (value as Record<string, unknown>)[MARKER_KEY];
  if (!marker || typeof marker !== "object" || Array.isArray(marker))
    return undefined;
  const candidate = marker as Record<string, unknown>;
  return candidate.version === 1 &&
    typeof candidate.digest === "string" &&
    /^[a-f0-9]{64}$/.test(candidate.digest) &&
    typeof candidate.byteLength === "number" &&
    Number.isSafeInteger(candidate.byteLength) &&
    candidate.byteLength >= 0
    ? (candidate as ResultArtifactMarker)
    : undefined;
}

function artifactPath(
  home: string,
  conversationId: string,
  digest: string,
): string {
  return join(
    home,
    "conversations",
    conversationId,
    "artifacts",
    "tool-results",
    `${digest}.json`,
  );
}
