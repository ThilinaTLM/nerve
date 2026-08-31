import { chromiumLoopbackProxyBypassRules } from "./download-environment.js";
import type { desktopLog } from "../../logging.js";

type DesktopLog = typeof desktopLog;

export interface DesktopNetworkSessionPort {
  setProxy(configuration: {
    mode: "system";
    proxyBypassRules: string;
  }): Promise<void>;
  forceReloadProxyConfig(): Promise<void>;
  resolveProxy(url: string): Promise<string>;
}

export async function configureDesktopNetworkSession(
  networkSession: DesktopNetworkSessionPort,
  log: DesktopLog,
): Promise<void> {
  const startedAt = Date.now();
  try {
    await networkSession.setProxy({
      mode: "system",
      proxyBypassRules: chromiumLoopbackProxyBypassRules,
    });
    await networkSession.forceReloadProxyConfig();
    const loopbackProxy = await resolveSessionProxyForLog(
      networkSession,
      log,
      "http://127.0.0.1/",
    );
    void log("info", "network", "Configured desktop proxy bypass", {
      durationMs: Date.now() - startedAt,
      context: {
        proxyBypassRules: chromiumLoopbackProxyBypassRules,
        loopbackProxy,
      },
    });
  } catch (error) {
    void log("warn", "network", "Failed to configure proxy bypass", {
      error,
      durationMs: Date.now() - startedAt,
      context: { proxyBypassRules: chromiumLoopbackProxyBypassRules },
    });
  }
}

async function resolveSessionProxyForLog(
  networkSession: DesktopNetworkSessionPort,
  log: DesktopLog,
  url: string,
): Promise<string> {
  try {
    return redactProxyDescription(await networkSession.resolveProxy(url));
  } catch (error) {
    void log("warn", "network", "Failed to resolve session proxy", {
      error,
      context: { url: redactUrlForLog(url) },
    });
    return "unavailable";
  }
}

export function redactProxyDescription(value: string): string {
  return value
    .replace(/(https?:\/\/)([^\s/@]+)@/gi, "$1[redacted]@")
    .replace(/\b([A-Z]+)\s+([^\s/@]+:[^\s/@]+@)/g, "$1 [redacted]@");
}

export function redactUrlForLog(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "redacted";
      url.password = "";
    }
    return url.toString();
  } catch {
    return value.replace(/(https?:\/\/)([^\s/@]+)@/gi, "$1[redacted]@");
  }
}
