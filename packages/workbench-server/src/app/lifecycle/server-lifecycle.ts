import type {
  ServerHealth,
  ServerLifecycle,
  ServerLifecycleFailure,
  ServerLifecycleProgress,
} from "@nervekit/contracts/status";
import { version } from "../version.js";

export const UPGRADING_MESSAGE = "Upgrading local storage";

/** Owns the one `ServerLifecycle` value the HTTP surface reports. */
export interface ServerLifecycleHolder {
  get(): ServerLifecycle;
  health(): ServerHealth;
  starting(): void;
  upgrading(progress: ServerLifecycleProgress): void;
  ready(): void;
  failed(failure: ServerLifecycleFailure): void;
}

export function createServerLifecycleHolder(
  options: {
    startedAt?: string;
    version?: string;
    initial?: "starting" | "ready";
  } = {},
): ServerLifecycleHolder {
  const base = {
    version: options.version ?? version,
    startedAt: options.startedAt ?? new Date().toISOString(),
  };
  let current: ServerLifecycle =
    options.initial === "ready"
      ? { ...base, state: "ready", message: "Ready" }
      : { ...base, state: "starting", message: "Starting" };
  return {
    get: () => current,
    health: () => ({
      status: "ok",
      version: base.version,
      lifecycle: current.state,
    }),
    starting() {
      current = { ...base, state: "starting", message: "Starting" };
    },
    upgrading(progress) {
      current = {
        ...base,
        state: "upgrading",
        message: UPGRADING_MESSAGE,
        progress,
      };
    },
    ready() {
      current = { ...base, state: "ready", message: "Ready" };
    },
    failed(failure) {
      current = {
        ...base,
        state: "failed",
        message: failure.message,
        failure,
      };
    },
  };
}
