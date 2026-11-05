import {
  isMaintenanceActive,
  type MaintenanceOperation,
  type MaintenanceRequest,
} from "@nervekit/contracts/maintenance";
import { ControllerLifecycle } from "$lib/platform/lifecycle/controller-lifecycle";
import { createPoll } from "$lib/platform/polling/poll";
export interface MaintenanceControllerDeps {
  get(): Promise<MaintenanceOperation | null>;
  start(request: MaintenanceRequest): Promise<MaintenanceOperation>;
  cancel(id: string): Promise<MaintenanceOperation>;
  subscribe(handler: (operation: MaintenanceOperation) => void): () => void;
  changed(operation: MaintenanceOperation | null): void;
  terminal(operation: MaintenanceOperation, announce: boolean): Promise<void>;
  error(message: string, error: unknown): void;
}
export function shouldIgnoreMaintenanceUpdate(
  current: MaintenanceOperation | null,
  next: MaintenanceOperation | null,
): boolean {
  if (!current) return false;
  if (!next) return true;
  if (current.id === next.id) return next.revision <= current.revision;
  return next.createdAt < current.createdAt;
}
export class MaintenanceController {
  operation: MaintenanceOperation | null = null;
  #life = new ControllerLifecycle();
  #inFlight?: Promise<void>;
  #reload = false;
  #cancelling = false;
  #observed = new Set<string>();
  #terminal = new Set<string>();
  // Re-polls an active operation; events are the primary channel, this is the fallback.
  #poll = createPoll({
    run: () => this.load(),
    intervalMs: 2500,
    enabled: () =>
      this.#life.started &&
      !this.#inFlight &&
      isMaintenanceActive(this.operation),
  });
  constructor(private readonly deps: MaintenanceControllerDeps) {}
  start(): void {
    this.#life.start((scope) => {
      scope.onDispose(
        this.deps.subscribe((operation) => {
          if (scope.isCurrent()) this.apply(operation, true);
        }),
      );
      this.#poll.start();
      scope.onDispose(() => this.#poll.stop());
      void this.load();
    });
  }
  dispose(): void {
    this.#life.dispose();
  }
  reconnect(): void {
    if (this.#life.started) void this.load();
  }
  async load(): Promise<void> {
    if (this.#inFlight) {
      this.#reload = true;
      return this.#inFlight;
    }
    const isCurrent = this.#life.capture();
    this.#inFlight = this.deps
      .get()
      .then((operation) => {
        if (isCurrent() && this.#life.started) this.apply(operation, false);
      })
      .catch(() => {
        /* Retain known active state and retry after transient transport failures. */
      })
      .finally(() => {
        this.#inFlight = undefined;
        if (this.#reload && this.#life.started) {
          this.#reload = false;
          void this.load();
        } else this.schedule();
      });
    return this.#inFlight;
  }
  async startRequest(request: MaintenanceRequest): Promise<boolean> {
    this.start();
    const isCurrent = this.#life.capture();
    try {
      const operation = await this.deps.start(request);
      if (!isCurrent()) return false;
      this.#observed.add(operation.id);
      this.apply(operation, true);
      return true;
    } catch (error) {
      this.deps.error("Could not start cleanup", error);
      return false;
    }
  }
  async cancel(): Promise<void> {
    if (
      this.#cancelling ||
      !this.operation ||
      this.operation.cancellationRequested ||
      !this.operation.cancellable
    )
      return;
    const isCurrent = this.#life.capture();
    this.#cancelling = true;
    try {
      const operation = await this.deps.cancel(this.operation.id);
      if (isCurrent()) this.apply(operation, true);
    } catch (error) {
      this.deps.error("Could not stop cleanup", error);
    } finally {
      this.#cancelling = false;
    }
  }
  private apply(next: MaintenanceOperation | null, event: boolean): void {
    if (shouldIgnoreMaintenanceUpdate(this.operation, next)) return;
    const current = this.operation;
    this.operation = next;
    if (isMaintenanceActive(next)) this.#observed.add(next!.id);
    this.deps.changed(next);
    this.schedule();
    if (!next?.completedAt) return;
    const key = `${next.id}:${next.revision}`;
    if (this.#terminal.has(key)) return;
    this.#terminal.add(key);
    const announce =
      this.#observed.has(next.id) || (event && current?.id === next.id);
    void this.deps
      .terminal(next, announce)
      .catch((error) =>
        this.deps.error("Could not refresh after cleanup", error),
      );
  }
  private schedule(): void {
    this.#poll.reschedule();
  }
}
