import { binding } from "../binding/loader.js";
import type { NativeChangeMonitorHandle } from "../binding/contract.js";
import type {
  ChangeMonitorOptions,
  ChangeNotice,
  DirectoryMonitorScope,
  GitMonitorScope,
  MonitorDiagnostics,
  MonitorScopeState,
} from "./contracts.js";

export class ChangeMonitor {
  readonly #handle: NativeChangeMonitorHandle;
  #closed = false;

  constructor(
    onNotice: (notice: ChangeNotice) => void,
    options: ChangeMonitorOptions = {},
  ) {
    this.#handle = binding.createChangeMonitor(options, (error, notice) => {
      if (this.#closed || error) return;
      onNotice(notice);
    });
  }

  async syncDirectories(
    scope: DirectoryMonitorScope,
  ): Promise<MonitorScopeState> {
    this.#assertOpen();
    return this.#handle.syncDirectories(scope);
  }

  async syncGit(scope: GitMonitorScope): Promise<MonitorScopeState> {
    this.#assertOpen();
    return this.#handle.syncGit(scope);
  }

  async requestRefresh(scopeId: string): Promise<number> {
    this.#assertOpen();
    return this.#handle.requestRefresh(scopeId);
  }

  async remove(scopeId: string): Promise<void> {
    if (this.#closed) return;
    await this.#handle.remove(scopeId);
  }

  diagnostics(): MonitorDiagnostics {
    this.#assertOpen();
    return this.#handle.diagnostics();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#handle.close();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Change monitor is closed");
  }
}
