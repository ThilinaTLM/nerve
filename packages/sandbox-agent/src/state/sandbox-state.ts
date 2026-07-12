import path from "node:path";
import { EventOutbox } from "./event-outbox.js";
import { FileRpcIdempotencyStore } from "./rpc-idempotency-store.js";
import { JsonStore } from "./json-store.js";

export class SandboxStateStores {
  readonly idempotency: FileRpcIdempotencyStore;
  readonly events: EventOutbox;
  readonly status: JsonStore<Record<string, unknown>>;
  readonly connectivity: JsonStore<Record<string, unknown>>;
  constructor(readonly stateDir: string) {
    this.idempotency = new FileRpcIdempotencyStore(
      path.join(stateDir, "controller", "idempotency", "records.jsonl"),
      path.join(stateDir, "controller", "idempotency", "conflicts.jsonl"),
    );
    this.events = new EventOutbox(
      path.join(stateDir, "events", "outbox.jsonl"),
      path.join(stateDir, "events", "ack.json"),
    );
    this.status = new JsonStore(path.join(stateDir, "status.json"));
    this.connectivity = new JsonStore(
      path.join(stateDir, "controller", "connectivity.json"),
    );
  }
  async load(): Promise<void> {
    await Promise.all([this.idempotency.load(), this.events.load()]);
  }
}
