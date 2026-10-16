import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

/** Retain at most one JSONL record while reading a prior export. */
export function* readLines(path: string): Generator<string> {
  if (!existsSync(path)) return;
  const fd = openSync(path, "r");
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.alloc(64 * 1024);
  let parts: string[] = [];
  function* consume(chunk: string): Generator<string> {
    let start = 0;
    for (
      let end = chunk.indexOf("\n");
      end >= 0;
      end = chunk.indexOf("\n", start)
    ) {
      parts.push(chunk.slice(start, end));
      const line = parts.join("");
      parts = [];
      if (line) yield line;
      start = end + 1;
    }
    if (start < chunk.length) parts.push(chunk.slice(start));
  }
  try {
    let count: number;
    while ((count = readSync(fd, buffer)) > 0)
      yield* consume(decoder.write(buffer.subarray(0, count)));
    yield* consume(decoder.end());
    if (parts.length) yield parts.join("");
  } finally {
    closeSync(fd);
  }
}

/** SQLite BLOBs are losslessly encoded, not expanded into numeric object keys. */
export function serializeRecord(record: unknown): string {
  return JSON.stringify(record, (_key, value: unknown) =>
    value instanceof Uint8Array
      ? { $blob: Buffer.from(value).toString("base64") }
      : value,
  );
}
