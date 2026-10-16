import type { StoragePaths } from "../../storage-bootstrap/paths.js";

export interface MigrationProgress {
  step: string;
  description: string;
  phase: string;
  label?: string;
  done?: number;
  total?: number;
}

/**
 * A unit a step could not migrate or verify: a source conversation, or a
 * configuration file (`id` is its absolute path).
 */
export interface DiscardableItem {
  kind: "conversation" | "configuration";
  id: string;
  title?: string;
  reason: string;
}

/**
 * Thrown by a step when only individual units failed. The user may discard
 * them (see `discardFailedItems`) or roll the step back.
 */
export class DiscardableMigrationError extends Error {
  constructor(readonly items: DiscardableItem[]) {
    super(describeItems(items));
    this.name = "DiscardableMigrationError";
  }
}

function describeItems(items: DiscardableItem[]): string {
  const count = (kind: DiscardableItem["kind"], noun: string) => {
    const n = items.filter((item) => item.kind === kind).length;
    return n ? `${n} ${noun}${n === 1 ? "" : "s"}` : "";
  };
  const parts = [
    count("conversation", "conversation"),
    count("configuration", "configuration file"),
  ].filter(Boolean);
  return `${parts.join(" and ")} could not be upgraded`;
}

export interface StepContext {
  paths: StoragePaths;
  scratchDir: string;
  /** Item IDs the user chose to discard after a failed attempt. */
  discarded: ReadonlySet<string>;
  progress(phase: string, done?: number, total?: number, label?: string): void;
  log(message: string): void;
}

export interface MigrationStep {
  id: string;
  description: string;
  requiresFreeBytes?: number;
  run(context: StepContext): Promise<void>;
  verify?(context: StepContext): Promise<void>;
  /** Whether `rollback` can still restore the pre-step home. */
  canRollback?(context: StepContext): boolean;
  /** Restores the pre-step home after a failed, unrecorded attempt. */
  rollback?(context: StepContext): Promise<void>;
}

export function defineStep(step: MigrationStep): MigrationStep {
  return Object.freeze(step);
}

export interface RegisteredStep {
  step: MigrationStep;
  checksum: string;
  stage: "draft" | "released";
  releasedIn?: string;
}

export function validateRegistry(registry: readonly RegisteredStep[]): void {
  for (const [index, entry] of registry.entries()) {
    if (
      !entry.step.id.startsWith(`${String(index + 1).padStart(4, "0")}-`) ||
      !/^\d{4}-[a-z0-9-]+$/.test(entry.step.id)
    ) {
      throw new Error(`Invalid migration order or ID: ${entry.step.id}`);
    }
    if (
      !/^[a-f0-9]{64}$/.test(entry.checksum) ||
      (entry.stage === "released" && !entry.releasedIn)
    ) {
      throw new Error(`Invalid migration metadata: ${entry.step.id}`);
    }
    if (
      entry.step.requiresFreeBytes !== undefined &&
      (!Number.isSafeInteger(entry.step.requiresFreeBytes) ||
        entry.step.requiresFreeBytes < 0)
    ) {
      throw new Error(`Invalid disk requirement: ${entry.step.id}`);
    }
  }
}
