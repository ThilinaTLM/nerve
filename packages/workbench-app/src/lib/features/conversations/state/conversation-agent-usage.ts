import type { ConversationAgentUsage } from "@nervekit/contracts/core";

export interface AgentUsageState {
  usage?: ConversationAgentUsage;
  loading: boolean;
  error?: string;
}

interface UsageControllerOptions {
  fetch: (conversationId: string) => Promise<ConversationAgentUsage>;
  publish: (state: AgentUsageState) => void;
  schedule?: (callback: () => void, delay: number) => () => void;
}

/** Fetch persisted usage only while its consumer is visible and connected. */
export class ConversationAgentUsageController {
  private id: string | undefined;
  private enabled = false;
  private generation = 0;
  private pending = false;
  private disposed = false;
  private cancelTimer: (() => void) | undefined;
  private state: AgentUsageState = { loading: false };
  private readonly schedule: NonNullable<UsageControllerOptions["schedule"]>;

  constructor(private readonly options: UsageControllerOptions) {
    this.schedule =
      options.schedule ??
      ((callback, delay) => {
        const timer = setTimeout(callback, delay);
        return () => clearTimeout(timer);
      });
  }

  configure(id: string | undefined, enabled: boolean): void {
    if (this.disposed || (id === this.id && enabled === this.enabled)) return;
    const changed = id !== this.id;
    this.generation++;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.id = id;
    this.enabled = enabled;
    const loading = enabled && !!id;
    this.state = changed ? { loading } : { ...this.state, loading };
    this.options.publish(this.state);
    if (enabled && id) void this.refresh();
  }

  retry(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    void this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
  }

  private async refresh(): Promise<void> {
    if (this.disposed || !this.enabled || !this.id || this.pending) return;
    const generation = this.generation;
    const id = this.id;
    this.pending = true;
    this.state = { ...this.state, loading: true };
    this.options.publish(this.state);
    try {
      const usage = await this.options.fetch(id);
      if (generation !== this.generation || this.disposed) return;
      this.state = { usage, loading: false };
      this.options.publish(this.state);
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.state = { ...this.state, loading: false, error: String(error) };
      this.options.publish(this.state);
    } finally {
      this.pending = false;
      if (!this.disposed && this.enabled && this.id) {
        if (generation !== this.generation) void this.refresh();
        else
          this.cancelTimer = this.schedule(() => {
            this.cancelTimer = undefined;
            void this.refresh();
          }, 3000);
      }
    }
  }
}
