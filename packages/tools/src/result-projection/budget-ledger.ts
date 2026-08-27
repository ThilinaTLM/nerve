import { measureBlocks } from "./measure.js";
import type { ProjectionBudget } from "./profiles.js";
import type { ProjectableBlock } from "./types.js";

export class ProjectionBudgetLedger {
  readonly blocks: ProjectableBlock[] = [];
  private bytes = 0;
  private lines = 0;
  private items = 0;

  constructor(readonly budget: ProjectionBudget) {}

  canCommit(blocks: readonly ProjectableBlock[], item = false): boolean {
    const measured = measureBlocks(blocks);
    return (
      this.bytes + measured.bytes <= this.budget.maxBytes &&
      this.lines + measured.lines <= this.budget.maxLines &&
      (!item ||
        this.budget.maxItems === undefined ||
        this.items + 1 <= this.budget.maxItems)
    );
  }

  commit(blocks: readonly ProjectableBlock[], item = false): boolean {
    if (!this.canCommit(blocks, item)) return false;
    const measured = measureBlocks(blocks);
    this.blocks.push(...blocks);
    this.bytes += measured.bytes;
    this.lines += measured.lines;
    if (item) this.items += 1;
    return true;
  }

  snapshot(): { bytes: number; lines: number; items: number } {
    return { bytes: this.bytes, lines: this.lines, items: this.items };
  }

  assertFits(): void {
    if (
      this.bytes > this.budget.maxBytes ||
      this.lines > this.budget.maxLines
    ) {
      throw new Error("Projected tool result exceeds its aggregate budget.");
    }
  }
}
