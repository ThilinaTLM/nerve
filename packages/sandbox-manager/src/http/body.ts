import type { IncomingMessage } from "node:http";
import { HttpError } from "./errors.js";

export type ReadJsonBodyOptions = {
  maxBytes?: number;
};

const DEFAULT_MAX_BYTES = 1024 * 1024;

export async function readJsonBody(
  req: IncomingMessage,
  options: ReadJsonBodyOptions = {},
): Promise<unknown> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > maxBytes)
      throw new HttpError(413, "Request too large", "REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks, bytes).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "Invalid JSON", "VALIDATION_FAILED");
  }
}
