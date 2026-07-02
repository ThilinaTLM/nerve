import path from "node:path";
import { CommandInbox } from "./command-inbox.js";
import { EventOutbox } from "./event-outbox.js";
import { JsonStore } from "./json-store.js";

export class SandboxStateStores {
  readonly commands: CommandInbox;
  readonly events: EventOutbox;
  readonly status: JsonStore<Record<string, unknown>>;
  readonly connectivity: JsonStore<Record<string, unknown>>;
  constructor(readonly stateDir: string) {
    this.commands = new CommandInbox(
      path.join(stateDir, "commands", "inbox.jsonl"),
    );
    this.events = new EventOutbox(
      path.join(stateDir, "events", "outbox.jsonl"),
      path.join(stateDir, "controller", "ack.json"),
    );
    this.status = new JsonStore(path.join(stateDir, "status.json"));
    this.connectivity = new JsonStore(
      path.join(stateDir, "controller", "connectivity.json"),
    );
  }
  async load(): Promise<void> {
    await Promise.all([this.commands.load(), this.events.load()]);
  }
}
