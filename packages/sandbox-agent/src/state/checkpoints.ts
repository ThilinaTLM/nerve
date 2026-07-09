import path from "node:path";
import { JsonStore } from "./json-store.js";

export class CheckpointStore<T = unknown> {
  constructor(private readonly stateDir: string) {}
  async write(name: string, value: T): Promise<void> {
    await new JsonStore<T>(
      path.join(this.stateDir, "checkpoints", `${safe(name)}.json`),
    ).write(value);
  }
  async read(name: string, defaultValue: T): Promise<T> {
    return new JsonStore<T>(
      path.join(this.stateDir, "checkpoints", `${safe(name)}.json`),
    ).read(defaultValue);
  }
}
function safe(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
