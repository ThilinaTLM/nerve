import { createWriteStream } from "node:fs";
import { pipeline, finished } from "node:stream/promises";
import type { ManagedProcess } from "@nervekit/native";

export const PROCESS_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;

export function captureProcessOutput(
  process: ManagedProcess,
  outputFiles: { stdout: string; stderr: string; combined: string },
  onProgress?: (update: { chunk: string; stream: "stdout" | "stderr" }) => void,
) {
  const combined = createWriteStream(outputFiles.combined);
  for (const stream of ["stdout", "stderr"] as const)
    process[stream].on("data", (chunk: Buffer) => {
      combined.write(chunk);
      onProgress?.({ stream, chunk: chunk.toString() });
    });
  const combinedDrain = finished(combined);
  const drains = Promise.all([
    pipeline(process.stdout, createWriteStream(outputFiles.stdout)),
    pipeline(process.stderr, createWriteStream(outputFiles.stderr)),
  ]).finally(() => combined.end());
  return Promise.all([drains, combinedDrain]);
}
