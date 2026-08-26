import type {
  CandidateContext,
  ProjectableBlock,
  ProjectionCandidate,
} from "./types.js";

export function conservativeFallbackCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const blocks = validContentBlocks(context.result) ?? [
    { type: "text", text: fallbackText(context.result) },
  ];
  return {
    blocks,
    artifacts: [...context.validatedArtifacts],
  };
}

export function validContentBlocks(
  value: unknown,
): ProjectableBlock[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const raw = (value as Record<string, unknown>).contentBlocks;
  if (!Array.isArray(raw) || raw.length === 0) return;
  const blocks: ProjectableBlock[] = [];
  for (const block of raw) {
    if (!block || typeof block !== "object" || Array.isArray(block)) return;
    const record = block as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      blocks.push({ type: "text", text: record.text });
    } else if (
      record.type === "image" &&
      typeof record.data === "string" &&
      typeof record.mimeType === "string"
    ) {
      blocks.push({
        type: "image",
        data: record.data,
        mimeType: record.mimeType,
      });
    } else return;
  }
  return blocks;
}

export function fallbackText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.content === "string") return record.content;
    const output: string[] = [];
    if (typeof record.stdout === "string" && record.stdout.length > 0) {
      output.push(`stdout:\n${record.stdout}`);
    }
    if (typeof record.stderr === "string" && record.stderr.length > 0) {
      output.push(`stderr:\n${record.stderr}`);
    }
    if (record.exitCode !== undefined)
      output.push(`exitCode: ${String(record.exitCode)}`);
    if (output.length > 0) return output.join("\n\n");
  }
  try {
    return JSON.stringify(redactImageData(value), null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function redactImageData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactImageData);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    if (key === "data" && record.type === "image")
      output[key] = "[image data omitted]";
    else output[key] = redactImageData(nested);
  }
  return output;
}
