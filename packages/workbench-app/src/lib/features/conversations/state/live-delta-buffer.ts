/** Non-reactive accumulation of high-rate live deltas, committed in batches. */

export interface LiveBlockShape {
  turnId: string;
  contentIndex: number;
  text: string;
  thinking: string;
  toolCall?: { providerCallId: string; name: string; partialArgsText: string };
}

export interface LiveBatch {
  blocks: LiveBlockShape[];
  toolOutput: Record<string, string>;
}

export type LiveScheduler = (callback: () => void) => () => void;

/** One animation frame, or a timer while hidden (rAF never fires there). */
export const defaultLiveScheduler: LiveScheduler = (callback) => {
  const hidden = typeof document !== "undefined" && document.hidden;
  if (!hidden && typeof requestAnimationFrame === "function") {
    const frame = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(frame);
  }
  const timer = setTimeout(callback, hidden ? 250 : 16);
  return () => clearTimeout(timer);
};

export class LiveDeltaBuffer {
  private blocks = new Map<string, LiveBlockShape>();
  private toolOutput: Record<string, string> = {};
  private hasToolOutput = false;
  private cancel: (() => void) | undefined;
  private disposed = false;

  constructor(
    private readonly commit: (batch: LiveBatch) => void,
    private readonly schedule: LiveScheduler = defaultLiveScheduler,
  ) {}

  get pending(): boolean {
    return this.blocks.size > 0 || this.hasToolOutput;
  }

  text(turnId: string, contentIndex: number, delta: string): void {
    this.block(turnId, contentIndex).text += delta;
    this.arm();
  }

  thinking(turnId: string, contentIndex: number, delta: string): void {
    this.block(turnId, contentIndex).thinking += delta;
    this.arm();
  }

  toolCall(
    turnId: string,
    contentIndex: number,
    toolCall: NonNullable<LiveBlockShape["toolCall"]>,
  ): void {
    this.block(turnId, contentIndex).toolCall = toolCall;
    this.arm();
  }

  progress(toolCallId: string, chunk: string): void {
    this.toolOutput[toolCallId] = (this.toolOutput[toolCallId] ?? "") + chunk;
    this.hasToolOutput = true;
    this.arm();
  }

  /** Commits everything buffered so far, synchronously. */
  flush(): void {
    this.disarm();
    if (!this.pending) return;
    const batch: LiveBatch = {
      blocks: [...this.blocks.values()],
      toolOutput: this.toolOutput,
    };
    this.blocks = new Map();
    this.toolOutput = {};
    this.hasToolOutput = false;
    this.commit(batch);
  }

  dropTurn(turnId: string): void {
    for (const [key, block] of this.blocks)
      if (block.turnId === turnId) this.blocks.delete(key);
    this.settle();
  }

  dropToolOutput(toolCallId: string): void {
    delete this.toolOutput[toolCallId];
    this.hasToolOutput = Object.keys(this.toolOutput).length > 0;
    this.settle();
  }

  clear(): void {
    this.blocks = new Map();
    this.toolOutput = {};
    this.hasToolOutput = false;
    this.disarm();
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  private block(turnId: string, contentIndex: number): LiveBlockShape {
    const key = `${turnId}\0${contentIndex}`;
    let block = this.blocks.get(key);
    if (!block) {
      block = { turnId, contentIndex, text: "", thinking: "" };
      this.blocks.set(key, block);
    }
    return block;
  }

  private arm(): void {
    if (this.disposed || this.cancel) return;
    this.cancel = this.schedule(() => {
      this.cancel = undefined;
      this.flush();
    });
  }

  private disarm(): void {
    this.cancel?.();
    this.cancel = undefined;
  }

  private settle(): void {
    if (!this.pending) this.disarm();
  }
}

/**
 * Applies a batch without mutating `blocks`: only touched blocks get new
 * objects, untouched ones keep identity.
 */
export function applyLiveBatch<T extends LiveBlockShape>(
  blocks: readonly T[],
  batch: readonly LiveBlockShape[],
): T[] {
  if (batch.length === 0) return blocks as T[];
  const next = [...blocks];
  for (const delta of batch) {
    const index = next.findIndex(
      (block) =>
        block.turnId === delta.turnId &&
        block.contentIndex === delta.contentIndex,
    );
    if (index < 0) {
      next.push({ ...delta } as T);
      continue;
    }
    const block = next[index];
    next[index] = {
      ...block,
      text: block.text + delta.text,
      thinking: block.thinking + delta.thinking,
      toolCall: delta.toolCall ?? block.toolCall,
    };
  }
  return next;
}
