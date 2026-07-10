const EXECUTION_RESULT_KEYS = [
  "content",
  "contentBlocks",
  "details",
  "path",
  "entries",
  "matches",
  "stdout",
  "stderr",
  "exitCode",
] as const;

const EMBEDDED_EXECUTION_RESULT_KEYS = [
  "content",
  "contentBlocks",
  "path",
  "entries",
  "matches",
  "stdout",
  "stderr",
] as const;

type JsonRecord = Record<string, unknown>;
type PreviewContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/**
 * Convert agent-facing tool result envelopes into the execution-result preview
 * shape consumed by the shared conversation UI. The helper only reshapes data
 * that is already present in the sandbox record; it does not dereference
 * artifacts, expand files, or reveal additional fields.
 */
export function toolResultPreview(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (isExecutionResultLike(value)) return value;
  const record = asRecord(value);
  if (!record) return value;

  const details = record.details;
  if (isEmbeddedExecutionResult(details)) return details;

  if (!Array.isArray(record.content)) return value;
  const contentBlocks = toContentBlocks(record.content);
  const text = contentBlocks
    .flatMap((block) =>
      block.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("\n");
  const preview: JsonRecord = {};
  if (text) preview.content = text;
  if (contentBlocks.length > 0) preview.contentBlocks = contentBlocks;
  copyExecutionFields(preview, details);
  if (details !== undefined) preview.details = details;
  return Object.keys(preview).length > 0 ? preview : value;
}

function isExecutionResultLike(value: unknown): value is JsonRecord {
  const record = asRecord(value);
  if (!record) return false;
  if (Array.isArray(record.content)) return false;
  return EXECUTION_RESULT_KEYS.some((key) => key in record);
}

function isEmbeddedExecutionResult(value: unknown): value is JsonRecord {
  const record = asRecord(value);
  if (!record) return false;
  if (Array.isArray(record.content)) return false;
  return EMBEDDED_EXECUTION_RESULT_KEYS.some((key) => key in record);
}

function copyExecutionFields(target: JsonRecord, source: unknown): void {
  const record = asRecord(source);
  if (!record) return;
  for (const key of EXECUTION_RESULT_KEYS) {
    if (key === "content" || key === "contentBlocks" || key === "details")
      continue;
    if (record[key] !== undefined) target[key] = record[key];
  }
}

function toContentBlocks(content: unknown[]): PreviewContentBlock[] {
  const out: PreviewContentBlock[] = [];
  for (const block of content) {
    const record = asRecord(block);
    if (!record) continue;
    if (record.type === "text" && typeof record.text === "string") {
      out.push({ type: "text", text: record.text });
      continue;
    }
    if (record.type === "image" && typeof record.data === "string") {
      out.push({
        type: "image",
        data: record.data,
        mimeType:
          typeof record.mimeType === "string"
            ? record.mimeType
            : "application/octet-stream",
      });
    }
  }
  return out;
}

function asRecord(value: unknown): JsonRecord | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return undefined;
}
