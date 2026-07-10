import {
  type TaskLaunchConfig,
  taskLaunchConfigSchema,
} from "@nervekit/contracts";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";

export interface TaskLaunchConfigStore {
  write(taskId: string, config: TaskLaunchConfig): Promise<void>;
  read(taskId: string): Promise<TaskLaunchConfig | undefined>;
  remove(taskId: string): Promise<void>;
}

export function taskLaunchConfigSecretName(taskId: string): string {
  return `task:${taskId}:launchConfig`;
}

export class SecretTaskLaunchConfigStore implements TaskLaunchConfigStore {
  constructor(private readonly secrets: SecretProvider) {}

  async write(taskId: string, config: TaskLaunchConfig): Promise<void> {
    const parsed = taskLaunchConfigSchema.parse(config);
    await this.secrets.set(
      taskLaunchConfigSecretName(taskId),
      JSON.stringify(parsed),
    );
  }

  async read(taskId: string): Promise<TaskLaunchConfig | undefined> {
    const value = await this.secrets.get(taskLaunchConfigSecretName(taskId));
    if (value === undefined) return undefined;

    let raw: unknown;
    try {
      raw = JSON.parse(value);
    } catch (error) {
      throw new Error(
        `Invalid persisted launch config for task ${taskId}: ${errorMessage(error)}`,
      );
    }

    const parsed = taskLaunchConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Invalid persisted launch config for task ${taskId}: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  async remove(taskId: string): Promise<void> {
    await this.secrets.delete(taskLaunchConfigSecretName(taskId));
  }
}

export class UnconfiguredTaskLaunchConfigStore
  implements TaskLaunchConfigStore
{
  async write(): Promise<void> {
    throw new Error(
      "Task launch config store is not configured; refusing to persist env overrides.",
    );
  }

  async read(): Promise<TaskLaunchConfig | undefined> {
    throw new Error(
      "Task launch config store is not configured; refusing to restart task with persisted env metadata.",
    );
  }

  async remove(): Promise<void> {
    // No launch config store is configured, so there is nothing to delete.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
