import { createId } from "@nervekit/contracts";
import { validatePublicEvent } from "@nervekit/contracts/events";
import type { NotifyEvent } from "@nervekit/contracts/events";

/** Best-effort workbench notices have no persistence or replay retention. */
export class WorkbenchNoticePublisher {
  private readonly listeners = new Set<(event: NotifyEvent) => void>();

  async publish(type: string, data: unknown): Promise<void> {
    const event = {
      id: createId("evt"),
      ts: new Date().toISOString(),
      type,
      data: validatePublicEvent(type, data, "workbench_server"),
    };
    for (const listener of this.listeners) listener(event);
  }

  publishBestEffort(type: string, data: unknown, _context?: string): void {
    void _context;
    void this.publish(type, data).catch(() => undefined);
  }
  async publishBestEffortAndWait(
    type: string,
    data: unknown,
    _context?: string,
  ): Promise<void> {
    void _context;
    await this.publish(type, data).catch(() => undefined);
  }
  subscribeNotify(listener: (event: NotifyEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
