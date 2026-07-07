import path from "node:path";
import { JsonStore } from "../state/json-store.js";

export class CredentialStore<T = unknown> {
  constructor(private readonly credentialsDir: string) {}
  async write(name: string, value: T): Promise<void> {
    await new JsonStore<T>(
      path.join(this.credentialsDir, `${safe(name)}.json`),
    ).write(value, 0o600);
  }
  async read(name: string, defaultValue: T): Promise<T> {
    return new JsonStore<T>(
      path.join(this.credentialsDir, `${safe(name)}.json`),
    ).read(defaultValue);
  }
}
function safe(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
