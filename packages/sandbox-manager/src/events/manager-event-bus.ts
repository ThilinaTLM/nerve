import { EventEmitter } from "node:events";

export type ManagerEvent = {
  type: string;
  stream?: string;
  sandboxId?: string;
  seq?: number;
  id?: string;
  durability?: "durable" | "transient";
  payload?: unknown;
  ts: string;
};

export class ManagerEventBus extends EventEmitter {
  publish(event: Omit<ManagerEvent, "ts"> & { ts?: string }): void {
    this.emit("event", { ...event, ts: event.ts ?? new Date().toISOString() });
  }
  subscribe(listener: (event: ManagerEvent) => void): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }
}
