import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Aborts after `milliseconds` without `touch()`, or when `signal` aborts; a long transfer stays alive while bytes flow. */
export function idleTimeoutSignal(
  signal: AbortSignal | undefined,
  milliseconds: number,
) {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const abort = (reason: unknown) => controller.abort(reason);
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => abort(new DOMException("Transfer timed out", "TimeoutError")),
      milliseconds,
    );
  };
  const onAbort = () => abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  touch();
  return {
    signal: controller.signal,
    touch,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

/** Thrown by `streamBodyToFile` when the body passes `maxBytes`. */
export class BodyTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super("Body exceeds the size limit.");
  }
}

/**
 * Streams a response body to `destination` without buffering it: the byte
 * count is enforced while streaming, `onChunk` lets the caller keep an idle
 * timer alive, and the partial file is deleted on any failure or abort.
 * Returns the bytes written.
 */
export async function streamBodyToFile(
  response: Response,
  destination: string,
  options: { maxBytes: number; signal?: AbortSignal; onChunk?: () => void },
): Promise<number> {
  const { maxBytes, signal, onChunk } = options;
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new BodyTooLargeError(declared);
  }
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      onChunk?.();
      if (bytes > maxBytes) callback(new BodyTooLargeError(bytes));
      else callback(null, chunk);
    },
  });
  try {
    if (response.body) {
      await pipeline(
        Readable.fromWeb(response.body as never),
        counter,
        createWriteStream(destination, { mode: 0o600 }),
        signal ? { signal } : {},
      );
    } else {
      await pipeline(
        Readable.from([]),
        createWriteStream(destination, { mode: 0o600 }),
      );
    }
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
  return bytes;
}
