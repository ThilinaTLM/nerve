import type {
  SandboxContainerLogChunk,
  StructuredLogLevel,
} from "@nervekit/contracts";

export type SandboxLogLine = {
  id: string;
  stream: string;
  ts?: string;
  level?: StructuredLogLevel;
  message: string;
  stage?: string;
  phase?: string;
  context: Record<string, unknown>;
  raw: string;
  structured: boolean;
};

const LEVELS = new Set<StructuredLogLevel>(["debug", "info", "warn", "error"]);

export function parseSandboxLogChunks(
  chunks: readonly SandboxContainerLogChunk[],
): SandboxLogLine[] {
  const lines: SandboxLogLine[] = [];
  let carry = "";
  let carryStream = "stdout";
  let carryTs: string | undefined;
  let sequence = 0;

  for (const chunk of chunks) {
    if (carry && carryStream !== chunk.stream) {
      lines.push(parseLine(carry, carryStream, carryTs, sequence++));
      carry = "";
    }
    carryStream = chunk.stream;
    carryTs = carryTs ?? chunk.ts;
    const parts = `${carry}${chunk.chunk}`.split(/\r?\n/);
    carry = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.trim()) continue;
      lines.push(parseLine(part, chunk.stream, chunk.ts, sequence++));
    }
    if (!carry) carryTs = undefined;
  }
  if (carry.trim())
    lines.push(parseLine(carry, carryStream, carryTs, sequence));
  return lines;
}

function parseLine(
  raw: string,
  stream: string,
  fallbackTs: string | undefined,
  index: number,
): SandboxLogLine {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return rawLine(raw, stream, fallbackTs, index);
    const record = parsed as Record<string, unknown>;
    if (typeof record.message !== "string")
      return rawLine(raw, stream, fallbackTs, index);
    const level =
      typeof record.level === "string" &&
      LEVELS.has(record.level as StructuredLogLevel)
        ? (record.level as StructuredLogLevel)
        : undefined;
    const ts = typeof record.ts === "string" ? record.ts : fallbackTs;
    const stage = typeof record.stage === "string" ? record.stage : undefined;
    const phase = typeof record.phase === "string" ? record.phase : undefined;
    const context = Object.fromEntries(
      Object.entries(record).filter(
        ([key]) =>
          !["ts", "level", "message", "stage", "phase", "source"].includes(key),
      ),
    );
    return {
      id: `${index}:${ts ?? "no-ts"}`,
      stream,
      ts,
      level,
      message: record.message,
      stage,
      phase,
      context,
      raw,
      structured: true,
    };
  } catch {
    return rawLine(raw, stream, fallbackTs, index);
  }
}

function rawLine(
  raw: string,
  stream: string,
  ts: string | undefined,
  index: number,
): SandboxLogLine {
  return {
    id: `${index}:${ts ?? "no-ts"}`,
    stream,
    ts,
    level: stream === "stderr" ? "error" : undefined,
    message: raw,
    context: {},
    raw,
    structured: false,
  };
}
