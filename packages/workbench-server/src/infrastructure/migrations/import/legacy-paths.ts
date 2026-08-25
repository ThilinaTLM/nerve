import { join } from "node:path";

export function legacyConfigPath(home: string): string {
  return join(home, "config.json");
}

export function legacyProvidersPath(home: string): string {
  return join(home, "providers.json");
}
