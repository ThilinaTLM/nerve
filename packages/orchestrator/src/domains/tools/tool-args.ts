import type { ProcessManager } from "../processes/process-manager.js";

export function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Tool argument '${name}' must be a non-empty string.`);
  }
  return value;
}

export function optionalStringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function stringRecordArg(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") output[key] = raw;
  }
  return output;
}

export function signalArg(
  value: unknown,
): "SIGTERM" | "SIGINT" | "SIGKILL" | undefined {
  return value === "SIGINT" || value === "SIGKILL" || value === "SIGTERM"
    ? value
    : undefined;
}

export function optionalFiniteNumberArg(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function processIdArg(
  args: Record<string, unknown>,
  processes: ProcessManager,
  projectId: string,
): string {
  let processId: string | undefined;
  if (typeof args.processId === "string" && args.processId.trim()) {
    processId = args.processId;
  } else if (typeof args.name === "string" && args.name.trim()) {
    processId = processes
      .listProcesses()
      .find(
        (process) =>
          process.name === args.name && process.projectId === projectId,
      )?.id;
  }
  if (!processId) {
    throw new Error("Tool argument 'processId' or 'name' is required.");
  }
  const process = processes.getProcess(processId);
  if (process.projectId !== projectId) {
    throw new Error("Process is outside this agent's project scope.");
  }
  return process.id;
}
