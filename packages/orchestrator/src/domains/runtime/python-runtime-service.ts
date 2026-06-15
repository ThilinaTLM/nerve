import type { PythonRuntimeStatus as SharedPythonRuntimeStatus } from "@nerve/shared";
import {
  type PythonRuntime,
  type PythonRuntimeStatus,
  resolvePythonRuntime,
} from "@nerve/tools";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";

export class PythonRuntimeService {
  private readonly cache = new Map<string, Promise<PythonRuntimeStatus>>();
  private lastStatus: SharedPythonRuntimeStatus = {
    available: false,
    source: "unavailable",
    error: "Python runtime has not been resolved yet.",
  };

  constructor(private readonly storage: InitializedStorage) {}

  async refresh(
    projectDir = process.cwd(),
  ): Promise<SharedPythonRuntimeStatus> {
    this.cache.clear();
    const status = await this.statusForProject(projectDir);
    this.lastStatus = toSharedStatus(status);
    return this.lastStatus;
  }

  statusSnapshot(): SharedPythonRuntimeStatus {
    return this.lastStatus;
  }

  async isAvailableForProject(projectDir: string): Promise<boolean> {
    return (await this.statusForProject(projectDir)).available;
  }

  async runtimeForProject(
    projectDir: string,
  ): Promise<PythonRuntime | undefined> {
    const status = await this.statusForProject(projectDir);
    if (!status.available) return undefined;
    return {
      command: status.command,
      args: status.args,
      displayPath: status.displayPath,
      version: status.version,
      source: status.source,
    };
  }

  async statusForProject(projectDir: string): Promise<PythonRuntimeStatus> {
    const manualPath = this.storage.settings.runtime.pythonExecutablePath;
    const key = `${manualPath ?? "auto"}\0${projectDir}`;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = resolvePythonRuntime({ cwd: projectDir, manualPath });
      this.cache.set(key, pending);
    }
    const status = await pending;
    this.lastStatus = toSharedStatus(status);
    return status;
  }
}

function toSharedStatus(
  status: PythonRuntimeStatus,
): SharedPythonRuntimeStatus {
  if (!status.available) {
    return {
      available: false,
      source: "unavailable",
      error: status.error,
    };
  }
  return {
    available: true,
    source: status.source,
    executable: status.displayPath,
    version: status.version,
  };
}
