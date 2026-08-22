import type { WorkbenchStartupPhase } from "./workbench-startup-sequence";
import { WorkbenchStartupMachine } from "./workbench-startup-machine";

class WorkbenchStartupState {
  phase = $state<WorkbenchStartupPhase>("idle");
  generation = $state(0);
  error = $state<unknown>();

  get coreReady(): boolean {
    return this.phase === "core-ready" || this.phase === "progressive";
  }

  get progressiveActive(): boolean {
    return this.phase === "progressive";
  }
}

const machine = new WorkbenchStartupMachine();
export const workbenchStartupState = new WorkbenchStartupState();

function publishMachineState(): void {
  workbenchStartupState.phase = machine.phase;
  workbenchStartupState.generation = machine.generation;
  workbenchStartupState.error = machine.error;
}

export function beginWorkbenchStartup(): number {
  const generation = machine.begin();
  publishMachineState();
  return generation;
}

export function isWorkbenchStartupGenerationCurrent(generation: number) {
  return machine.isCurrent(generation);
}

export function transitionWorkbenchStartup(
  generation: number,
  phase: WorkbenchStartupPhase,
  error?: unknown,
): boolean {
  const transitioned = machine.transition(generation, phase, error);
  if (transitioned) publishMachineState();
  return transitioned;
}

export function failWorkbenchStartup(generation: number, error: unknown) {
  return transitionWorkbenchStartup(generation, "failed", error);
}

export function stopWorkbenchStartup(generation?: number): boolean {
  const stopped = machine.stop(generation);
  if (stopped) publishMachineState();
  return stopped;
}
