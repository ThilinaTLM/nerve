import { EventEmitter } from "node:events";
import type { NotifyEvent } from "@nervekit/contracts";

/** A complete catalog-validated sequenced event ready for UI publication. */
export type ManagerEvent = {
  stream: string;
  sandboxId?: string;
  id: string;
  seq: number;
  type: string;
  ts: string;
  payload: Record<string, unknown>;
};

/** An unsequenced best-effort event with its manager routing context. */
export type ManagerNotify = {
  stream: string;
  sandboxId?: string;
  event: NotifyEvent<Record<string, unknown>>;
};

export class ManagerEventBus extends EventEmitter {
  publish(event: ManagerEvent): void {
    this.emit("event", event);
  }

  notify(notification: ManagerNotify): void {
    this.emit("notify", notification);
  }

  subscribe(listener: (event: ManagerEvent) => void): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }

  subscribeNotify(listener: (notification: ManagerNotify) => void): () => void {
    this.on("notify", listener);
    return () => this.off("notify", listener);
  }
}
