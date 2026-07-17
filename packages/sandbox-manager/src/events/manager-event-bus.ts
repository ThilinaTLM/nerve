import { EventEmitter } from "node:events";

/** A complete, catalog-validated event ready for protocol publication. */
export type ManagerEvent = {
  stream: string;
  sandboxId?: string;
  id: string;
  seq: number;
  type: string;
  ts: string;
  durability: "durable" | "transient";
  payload: Record<string, unknown>;
};

export class ManagerEventBus extends EventEmitter {
  publish(event: ManagerEvent): void {
    this.emit("event", event);
  }

  subscribe(listener: (event: ManagerEvent) => void): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }
}
