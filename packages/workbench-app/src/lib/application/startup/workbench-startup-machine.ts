import type { WorkbenchStartupPhase } from "./workbench-startup-sequence";

const phaseOrder: Partial<Record<WorkbenchStartupPhase, number>> = {
  idle: 0,
  critical: 1,
  "core-ready": 2,
  progressive: 3,
};

export function shouldRevealWorkbench(phase: WorkbenchStartupPhase): boolean {
  return (
    phase === "core-ready" || phase === "progressive" || phase === "failed"
  );
}

export class WorkbenchStartupMachine {
  phase: WorkbenchStartupPhase = "idle";
  generation = 0;
  error: unknown;

  begin(): number {
    this.generation += 1;
    this.phase = "idle";
    this.error = undefined;
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return this.generation === generation && this.phase !== "stopped";
  }

  transition(
    generation: number,
    phase: WorkbenchStartupPhase,
    error?: unknown,
  ): boolean {
    if (!this.isCurrent(generation)) return false;
    if (phase === "failed") {
      if (this.phase === "progressive") return false;
      this.phase = phase;
      if (error !== undefined) this.error = error;
      return true;
    }
    if (phase === "stopped") return this.stop(generation);
    const currentOrder = phaseOrder[this.phase];
    const nextOrder = phaseOrder[phase];
    if (
      currentOrder === undefined ||
      nextOrder === undefined ||
      nextOrder !== currentOrder + 1
    ) {
      return false;
    }
    this.phase = phase;
    return true;
  }

  stop(generation?: number): boolean {
    if (generation !== undefined && generation !== this.generation)
      return false;
    this.generation += 1;
    this.phase = "stopped";
    return true;
  }
}
