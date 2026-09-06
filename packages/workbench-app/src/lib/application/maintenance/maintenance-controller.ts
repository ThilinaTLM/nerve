import {
  isMaintenanceActive,
  type MaintenanceOperation,
  type MaintenanceRequest,
} from "@nervekit/contracts/maintenance";
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
  #generation = 0;
  #started = false;
  #unsubscribe?: () => void;
  #timer?: ReturnType<typeof setTimeout>;
  #inFlight?: Promise<void>;
  #reload = false;
  #cancelling = false;
  #observed = new Set<string>();
  #terminal = new Set<string>();
  constructor(private readonly deps: MaintenanceControllerDeps) {}
  start(): void {
    if (this.#started) return;
    this.#started = true;
    const generation = ++this.#generation;
    this.#unsubscribe = this.deps.subscribe((operation) => {
      if (generation === this.#generation) this.apply(operation, true);
    });
    void this.load();
  }
  dispose(): void {
    this.#started = false;
    ++this.#generation;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
  reconnect(): void {
    if (this.#started) void this.load();
  }
  async load(): Promise<void> {
    if (this.#inFlight) {
      this.#reload = true;
      return this.#inFlight;
    }
    const generation = this.#generation;
    this.#inFlight = this.deps
      .get()
      .then((operation) => {
        if (generation === this.#generation && this.#started)
          this.apply(operation, false);
      })
      .catch(() => {
        /* Retain known active state and retry after transient transport failures. */
      })
      .finally(() => {
        this.#inFlight = undefined;
        if (this.#reload && this.#started) {
          this.#reload = false;
          void this.load();
        } else this.schedule();
      });
    return this.#inFlight;
  }
  async startRequest(request: MaintenanceRequest): Promise<boolean> {
    this.start();
    const generation = this.#generation;
    try {
      const operation = await this.deps.start(request);
      if (generation !== this.#generation) return false;
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
    const generation = this.#generation;
    this.#cancelling = true;
    try {
      const operation = await this.deps.cancel(this.operation.id);
      if (generation === this.#generation) this.apply(operation, true);
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
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#started && !this.#inFlight && isMaintenanceActive(this.operation))
      this.#timer = setTimeout(() => void this.load(), 2500);
  }
}
