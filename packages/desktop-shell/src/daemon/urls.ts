/** Pure URL/host policy for daemon connections. */

export function normalizeRemoteDaemonUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Remote daemon URL must use http:// or https://.");
  }
  return url.origin;
}

/** Convert a locally advertised daemon URL into a connectable origin. */
export function localConnectUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:") return undefined;
    if (url.hostname === "0.0.0.0" || url.hostname === "::") {
      url.hostname = "127.0.0.1";
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

// Re-exported so daemon peers can keep importing from ./urls.js.
export { isLoopbackHost } from "@nervekit/workbench-server";
