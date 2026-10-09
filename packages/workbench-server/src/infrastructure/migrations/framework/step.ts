import type { StoragePaths } from "../../storage-bootstrap/paths.js";

export interface MigrationProgress {
  step: string;
  phase: string;
  done?: number;
  total?: number;
}

export interface StepContext {
  paths: StoragePaths;
  scratchDir: string;
  progress(phase: string, done?: number, total?: number): void;
  log(message: string): void;
}

export interface MigrationStep {
  id: string;
  description: string;
  requiresFreeBytes?: number;
  run(context: StepContext): Promise<void>;
  verify?(context: StepContext): Promise<void>;
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
