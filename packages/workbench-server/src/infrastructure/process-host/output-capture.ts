import { createWriteStream, type WriteStream } from "node:fs";
import { Writable } from "node:stream";
import { pipeline, finished } from "node:stream/promises";
import type { ManagedProcess } from "@nervekit/native";

export const PROCESS_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
export const PROCESS_DIAGNOSTIC_RESERVE_BYTES = 16 * 1024;

export function captureProcessOutput(
  process: Pick<ManagedProcess, "stdout" | "stderr">,
  outputFiles: { stdout: string; stderr: string; combined: string },
  onProgress?: (update: { chunk: string; stream: "stdout" | "stderr" }) => void,
  diagnostic?: () => Promise<string | undefined>,
) {
  const files = {
    stdout: createWriteStream(outputFiles.stdout),
    stderr: createWriteStream(outputFiles.stderr),
    combined: createWriteStream(outputFiles.combined),
  };
  // Observe errors immediately, including files that have not received output yet.
  const fileDrains = Promise.all(
    Object.values(files).map((file) => finished(file)),
  );
  void fileDrains.catch(() => undefined);
  let queue = Promise.resolve();
  let bytes = 0;
  const truncationNotice = Buffer.from(
    "\n[Nerve: process output truncated at capture limit]\n",
  );
  let truncated = false;
  const childLimit =
    PROCESS_OUTPUT_LIMIT_BYTES -
    truncationNotice.length -
    (diagnostic ? PROCESS_DIAGNOSTIC_RESERVE_BYTES : 0);
  const write = (file: WriteStream, chunk: Buffer) =>
    new Promise<void>((resolve, reject) => {
      file.write(chunk, (error) => (error ? reject(error) : resolve()));
    });
  const append = (
    stream: "stdout" | "stderr",
    chunk: Buffer,
    limit: number,
  ) => {
    const bounded = chunk.subarray(0, Math.max(0, limit - bytes));
    bytes += bounded.length;
    queue = queue.then(async () => {
      if (!bounded.length) return;
      await write(files[stream], bounded);
      await write(files.combined, bounded);
      onProgress?.({ stream, chunk: bounded.toString() });
    });
    return queue;
  };
  const drain = (stream: "stdout" | "stderr") =>
    pipeline(
      process[stream],
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          if (bytes + chunk.length > childLimit) truncated = true;
          void append(stream, chunk, childLimit).then(
            () => callback(),
            callback,
          );
        },
      }),
    );
  return (async () => {
    try {
      await Promise.all([drain("stdout"), drain("stderr")]);
      if (truncated)
        await append("stderr", truncationNotice, PROCESS_OUTPUT_LIMIT_BYTES);
      const text = await diagnostic?.();
      if (text)
        await append("stderr", Buffer.from(text), PROCESS_OUTPUT_LIMIT_BYTES);
      await queue;
      for (const file of Object.values(files)) file.end();
      await fileDrains;
    } catch (error) {
      for (const file of Object.values(files)) file.destroy();
      await queue.catch(() => undefined);
      await fileDrains.catch(() => undefined);
      throw error;
    }
  })();
}
