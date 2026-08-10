/**
 * Proxy-environment helpers shared between the daemon (workbench-server) and
 * the desktop shell's Electron downloader. They used to be duplicated in
 * workbench-server/src/main.ts and desktop-shell/src/electron-download-env.ts;
 * this module is the single source of truth.
 */

export const loopbackNoProxyEntries = ["localhost", "127.0.0.1", "::1"];

export function firstEnvValue(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function mergeNoProxySources(values: Array<string | undefined>): string {
  const entries: string[] = [];
  const normalizedEntries = new Set<string>();
  for (const value of values) {
    for (const entry of (value ?? "").split(",")) {
      const trimmed = entry.trim();
      const normalized = trimmed.toLowerCase();
      if (!trimmed || normalizedEntries.has(normalized)) continue;
      entries.push(trimmed);
      normalizedEntries.add(normalized);
    }
  }
  return entries.join(",");
}

export function mergeNoProxy(value: string): string {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const normalizedEntries = new Set(
    entries.map((entry) => entry.toLowerCase()),
  );
  for (const entry of loopbackNoProxyEntries) {
    if (normalizedEntries.has(entry.toLowerCase())) continue;
    entries.push(entry);
    normalizedEntries.add(entry.toLowerCase());
  }
  return entries.join(",");
}
