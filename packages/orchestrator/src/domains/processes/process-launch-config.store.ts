import {
  type ProcessLaunchConfig,
  processLaunchConfigSchema,
} from "@nerve/shared";
import type { SecretProvider } from "../../secrets.js";

export interface ProcessLaunchConfigStore {
  write(processId: string, config: ProcessLaunchConfig): Promise<void>;
  read(processId: string): Promise<ProcessLaunchConfig | undefined>;
  remove(processId: string): Promise<void>;
}

export function processLaunchConfigSecretName(processId: string): string {
  return `process:${processId}:launchConfig`;
}

export class SecretProcessLaunchConfigStore
  implements ProcessLaunchConfigStore
{
  constructor(private readonly secrets: SecretProvider) {}

  async write(processId: string, config: ProcessLaunchConfig): Promise<void> {
    const parsed = processLaunchConfigSchema.parse(config);
    await this.secrets.set(
      processLaunchConfigSecretName(processId),
      JSON.stringify(parsed),
    );
  }

  async read(processId: string): Promise<ProcessLaunchConfig | undefined> {
    const value = await this.secrets.get(
      processLaunchConfigSecretName(processId),
    );
    if (value === undefined) return undefined;

    let raw: unknown;
    try {
      raw = JSON.parse(value);
    } catch (error) {
      throw new Error(
        `Invalid persisted launch config for process ${processId}: ${errorMessage(error)}`,
      );
    }

    const parsed = processLaunchConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Invalid persisted launch config for process ${processId}: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  async remove(processId: string): Promise<void> {
    await this.secrets.delete(processLaunchConfigSecretName(processId));
  }
}

export class UnconfiguredProcessLaunchConfigStore
  implements ProcessLaunchConfigStore
{
  async write(): Promise<void> {
    throw new Error(
      "Process launch config store is not configured; refusing to persist env overrides.",
    );
  }

  async read(): Promise<ProcessLaunchConfig | undefined> {
    throw new Error(
      "Process launch config store is not configured; refusing to restart process with persisted env metadata.",
    );
  }

  async remove(): Promise<void> {
    // No launch config store is configured, so there is nothing to delete.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
