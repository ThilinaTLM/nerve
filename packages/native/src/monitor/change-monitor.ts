import { binding } from "../binding/loader.js";
import type { NativeChangeMonitorHandle } from "./binding.js";
import type {
  ChangeMonitorOptions,
  ChangeNotice,
  DirectoryMonitorScope,
  GitMonitorScope,
  MonitorDiagnostics,
  MonitorScopeState,
  TreeMonitorScope,
} from "./contracts.js";

const monitorFinalizer = new FinalizationRegistry<NativeChangeMonitorHandle>(
  (handle) => {
    void binding.closeChangeMonitor(handle).catch(() => undefined);
  },
);

export class ChangeMonitor {
  readonly #handle: NativeChangeMonitorHandle;
  readonly #finalizerToken = {};
  #closed = false;

  constructor(
    onNotice: (notice: ChangeNotice) => void,
    options: ChangeMonitorOptions = {},
  ) {
    this.#handle = binding.createChangeMonitor(options, (error, notice) => {
      if (this.#closed || error) return;
      onNotice(notice);
    });
    monitorFinalizer.register(this, this.#handle, this.#finalizerToken);
  }

  async syncDirectories(
    scope: DirectoryMonitorScope,
  ): Promise<MonitorScopeState> {
    this.#assertOpen();
    return binding.syncChangeMonitorDirectories(this.#handle, scope);
  }

  /** Whether the loaded addon supports recursive, ignore-filtered tree scopes. */
  static supportsTreeScopes(): boolean {
    return typeof binding.syncChangeMonitorTree === "function";
  }

  async syncTree(scope: TreeMonitorScope): Promise<MonitorScopeState> {
    this.#assertOpen();
    if (!binding.syncChangeMonitorTree)
      throw new Error("Native tree monitoring is not available");
    return binding.syncChangeMonitorTree(this.#handle, scope);
  }

  async syncGit(scope: GitMonitorScope): Promise<MonitorScopeState> {
    this.#assertOpen();
    return binding.syncChangeMonitorGit(this.#handle, scope);
  }

  async requestRefresh(scopeId: string): Promise<number> {
    this.#assertOpen();
    return binding.requestChangeMonitorRefresh(this.#handle, scopeId);
  }

  async remove(scopeId: string): Promise<void> {
    if (this.#closed) return;
    await binding.removeChangeMonitorScope(this.#handle, scopeId);
  }

  diagnostics(): MonitorDiagnostics {
    this.#assertOpen();
    return binding.changeMonitorDiagnostics(this.#handle);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    monitorFinalizer.unregister(this.#finalizerToken);
    await binding.closeChangeMonitor(this.#handle);
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Change monitor is closed");
  }
}
