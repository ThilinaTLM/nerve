export const PROCESS_CAPTURE_HEAD_MAX_BYTES = 32 * 1024 * 1024;
export const PROCESS_CAPTURE_TAIL_MAX_BYTES = 512 * 1024;

export type ProcessOutputChunk = {
  stream: "stdout" | "stderr";
  data: Buffer;
};

export type BoundedProcessOutputSnapshot = {
  stdoutChunks: Buffer[];
  stderrChunks: Buffer[];
  combinedChunks: Buffer[];
  totalBytes: number;
  retainedBytes: number;
  omittedBytes: number;
  truncated: boolean;
};

/**
 * Retains a generous process-output head and a small rolling tail. Memory is
 * bounded independently of child output volume; callers still own pipe
 * backpressure and durable task logging.
 */
function streamChunks(
  head: ProcessOutputChunk[],
  tail: ProcessOutputChunk[],
  stream: "stdout" | "stderr",
  marker?: Buffer,
): Buffer[] {
  const headChunks = head
    .filter((chunk) => chunk.stream === stream)
    .map((chunk) => chunk.data);
  const tailChunks = tail
    .filter((chunk) => chunk.stream === stream)
    .map((chunk) => chunk.data);
  return [
    ...headChunks,
    ...(marker && headChunks.length > 0 && tailChunks.length > 0
      ? [marker]
      : []),
    ...tailChunks,
  ];
}

export class BoundedProcessOutput {
  readonly #head: ProcessOutputChunk[] = [];
  readonly #tail: ProcessOutputChunk[] = [];
  #headBytes = 0;
  #tailBytes = 0;
  #totalBytes = 0;

  constructor(
    private readonly headMaxBytes = PROCESS_CAPTURE_HEAD_MAX_BYTES,
    private readonly tailMaxBytes = PROCESS_CAPTURE_TAIL_MAX_BYTES,
  ) {}

  push(stream: "stdout" | "stderr", chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.#totalBytes += chunk.length;
    const available = Math.max(0, this.headMaxBytes - this.#headBytes);
    const headLength = Math.min(available, chunk.length);
    if (headLength > 0) {
      const retained = Buffer.from(chunk.subarray(0, headLength));
      this.#head.push({ stream, data: retained });
      this.#headBytes += retained.length;
    }
    if (headLength < chunk.length) {
      this.#pushTail(stream, chunk.subarray(headLength));
    }
  }

  snapshot(): BoundedProcessOutputSnapshot {
    const selected = [...this.#head, ...this.#tail];
    const retainedBytes = selected.reduce(
      (total, chunk) => total + chunk.data.length,
      0,
    );
    const omittedBytes = Math.max(0, this.#totalBytes - retainedBytes);
    const marker = Buffer.from(
      `\n[${omittedBytes} output bytes omitted by process retention]\n`,
    );
    const stdoutChunks = streamChunks(
      this.#head,
      this.#tail,
      "stdout",
      omittedBytes > 0 ? marker : undefined,
    );
    const stderrChunks = streamChunks(
      this.#head,
      this.#tail,
      "stderr",
      omittedBytes > 0 ? marker : undefined,
    );
    const combinedChunks = [
      ...this.#head.map((chunk) => chunk.data),
      ...(omittedBytes > 0 ? [marker] : []),
      ...this.#tail.map((chunk) => chunk.data),
    ];
    return {
      stdoutChunks,
      stderrChunks,
      combinedChunks,
      totalBytes: this.#totalBytes,
      retainedBytes,
      omittedBytes,
      truncated: omittedBytes > 0,
    };
  }

  #pushTail(stream: "stdout" | "stderr", chunk: Buffer): void {
    const retained = Buffer.from(
      chunk.length > this.tailMaxBytes
        ? chunk.subarray(chunk.length - this.tailMaxBytes)
        : chunk,
    );
    this.#tail.push({ stream, data: retained });
    this.#tailBytes += retained.length;
    while (this.#tailBytes > this.tailMaxBytes && this.#tail.length > 0) {
      const first = this.#tail[0];
      if (!first) break;
      const excess = this.#tailBytes - this.tailMaxBytes;
      if (first.data.length <= excess) {
        this.#tail.shift();
        this.#tailBytes -= first.data.length;
      } else {
        first.data = first.data.subarray(excess);
        this.#tailBytes -= excess;
      }
    }
  }
}
