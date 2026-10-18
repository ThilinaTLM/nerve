import type {
  ChangeMonitorOptions,
  ChangeNotice,
  DirectoryMonitorScope,
  GitMonitorScope,
  MonitorDiagnostics,
  MonitorScopeState,
} from "./contracts.js";

export interface NativeChangeMonitorHandle {
  id: number;
}

export interface NativeMonitorBinding {
  createChangeMonitor(
    options: ChangeMonitorOptions | undefined,
    notice: (error: Error | null, notice: ChangeNotice) => void,
  ): NativeChangeMonitorHandle;
  syncChangeMonitorDirectories(
    handle: NativeChangeMonitorHandle,
    scope: DirectoryMonitorScope,
  ): Promise<MonitorScopeState>;
  syncChangeMonitorGit(
    handle: NativeChangeMonitorHandle,
    scope: GitMonitorScope,
  ): Promise<MonitorScopeState>;
  requestChangeMonitorRefresh(
    handle: NativeChangeMonitorHandle,
    scopeId: string,
  ): Promise<number>;
  removeChangeMonitorScope(
    handle: NativeChangeMonitorHandle,
    scopeId: string,
  ): Promise<void>;
  changeMonitorDiagnostics(
    handle: NativeChangeMonitorHandle,
  ): MonitorDiagnostics;
  closeChangeMonitor(handle: NativeChangeMonitorHandle): Promise<void>;
}
